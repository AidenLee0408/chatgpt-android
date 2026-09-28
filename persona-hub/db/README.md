# Persona Hub DB (PostgreSQL 16 + pgvector)

MVP 인메모리 `Store`(`server/src/core/store.ts`)를 대체할 스키마. 서버 코드는 아직 이 DB를 쓰지 않는다.

## 로컬 실행

```bash
docker compose -f db/docker-compose.yml up -d          # pgvector/pgvector:pg16 + redis:7
DATABASE_URL=postgres://persona:persona@localhost:5432/persona_hub db/scripts/migrate.sh
```

`migrate.sh`는 `migrations/*.sql`을 파일명 순서로, 파일당 한 트랜잭션(`psql -1`)으로 적용하고 `schema_migrations(version, checksum)`에 기록한다. 이미 적용된 파일은 건너뛰며, 내용이 바뀌었으면 경고만 낸다(적용된 마이그레이션은 수정하지 말고 새 파일을 추가).

| 파일 | 내용 |
|---|---|
| `0001_init.sql` | 전 테이블, FK, CHECK, 인덱스, `updated_at` 트리거 |
| `0002_partitions_retention.sql` | access_logs 월 파티션 관리, 1년 보관, query 원문 30일 삭제, TTL 정리 |
| `0003_rls.sql` | RLS 정책, `persona_app` / `persona_service` 역할 |

## 테이블 ↔ TS 타입 (`server/src/core/types.ts`)

| 테이블 | TS 타입 / Store 필드 | 비고 |
|---|---|---|
| `users` | `User` / `users` | `plan` CHECK free·pro, `consents` jsonb(`Consents`), `deleted_at`. 추가: `dek_wrapped`, `dek_key_id` (봉투 암호화) |
| `identities` | `Identity` / `identities` | PK `(provider, subject)`. TS `key` = `provider:subject` (저장하지 않고 조합) |
| `personas` | `Persona` | `version`(If-Match), `archived`. 사용자당 개수 제한(free 3 / pro 10 / 절대 10)은 **앱에서** 검사(403 `plan_limit_reached`) |
| `facts` | `Fact` | `body` → `body_plain`(normal) 또는 `body_enc`+`key_id`(sensitive·private). `user_id` 비정규화(RLS·파기·DEK 조회용). 소프트 삭제 없음 — 하드 삭제 |
| `connections` | `Connection` | `persona_ids text[]`(FK 불가 → 페르소나 삭제 시 앱이 배열에서 제거, GIN 인덱스), `max_sensitivity` CHECK normal·sensitive(private 불가), `revoked_at`, `version` |
| `access_logs` | `AccessLog` / `accessLogs` | 월 RANGE 파티션, PK `(id, created_at)`. 추가: `user_id`, `query_text`(30일 후 NULL) |
| `interviews` | `Interview` | `answers`, `candidates`는 jsonb 배열(`InterviewAnswer[]`, `FactCandidate[]`) |
| `exports` | `ExportJob` | `data` jsonb 스냅샷, `expires_at` 7일 |
| `auth_sessions` | `AuthSession` | `id` = refresh family id = JWT `sid` |
| `refresh_tokens` | `RefreshToken` | PK `hash`(sha256), `family_id` → `auth_sessions` CASCADE, `used`(재사용 감지). TS `expires_at`(epoch ms) ↔ timestamptz |
| `oauth_clients`, `oauth_codes`, `oauth_tokens` | (아직 TS 없음) | AI 클라이언트용 인가 서버. DCR, PKCE S256 only, 토큰은 해시만 저장, `family_id`로 회전·재사용 시 연결 전체 폐기 |
| `idempotency_keys` | (없음) | PK `(user_id, key)`, `request_hash`, 저장된 응답, `expires_at` 24h |
| `suggestions` | (v1) | `suggest_fact` 검수함. `op` add·update·remove, `status` pending·approved·rejected·expired |

공통: ID는 앱이 생성하는 접두사 ULID(`usr_`, `per_`, `fct_`, `con_`, `log_`, `itv_`, `exp_`, `sug_`, `ses_`…)이며 주요 테이블엔 접두사 CHECK가 있다. 시각은 `timestamptz`(UTC). `users`를 지우면 모든 사용자 데이터가 `ON DELETE CASCADE`로 사라진다(탈퇴 30일 파기). `updated_at`은 트리거가 갱신하지만 `version` 증가는 앱이 `UPDATE ... SET version = version + 1 WHERE id = $1 AND version = $2`로 한다(0행이면 409).

### API 쿼리별 인덱스

- 내 페르소나 목록: `personas (user_id, archived, updated_at DESC)`
- 페르소나 상세 / MCP `get_persona`: `facts (persona_id, sensitivity, updated_at DESC)`
- MCP `search_facts`: `facts USING hnsw (embedding vector_cosine_ops)` + `persona_id = ANY($scope)` 및 민감도 필터 (범위가 좁으면 플래너가 btree로 먼저 거른 뒤 정렬할 수 있음; HNSW 사용 시 `hnsw.ef_search`를 올리거나 iterative scan 고려)
- 연결 목록 / 활성 연결: `connections (user_id, created_at DESC)`, 부분 인덱스 `WHERE revoked_at IS NULL`
- 연결별 접근 기록: `access_logs (connection_id, created_at DESC)`, 사용자 전체 기록: `(user_id, created_at DESC)`
- 토큰 폐기: `oauth_tokens (connection_id)`, `(family_id)`; `refresh_tokens (family_id)`
- TTL 정리: 각 `expires_at` 인덱스

## 보관 정책

- `SELECT access_logs_maintain();` — 매일 실행(ECS 스케줄 작업 또는 pg_cron). 이번 달 + 3개월 파티션을 미리 만들고, 12개월보다 오래된 월 파티션은 `DETACH` 후 `DROP`(1년 보관, 행 단위 DELETE 없음). DEFAULT 파티션은 안전망이다. 비어 있어야 정상이며 모니터링 대상.
- `SELECT access_logs_purge_query_text();` — 매일. `search_facts` 입력 원문(`query_text`)을 30일 후 NULL로 만든다. `fact_ids`, `tool`은 1년 유지.
- `SELECT housekeeping_purge_expired();` — idempotency 24h, 만료 코드·토큰, 만료 export, **탈퇴 30일 경과 사용자 하드 삭제**(CASCADE).

## 봉투 암호화 설계 (민감·비공개 팩트 본문)

- **암호화·복호화는 앱 서비스(코어 서비스의 repo 계층)에서만** 한다. SQL(pgcrypto 등)에서는 하지 않는다. DB·백업·운영자는 평문 키도 평문 본문도 보지 못한다.
- 사용자별 데이터 키(DEK, 256bit): 첫 민감 팩트 저장 시 `KMS GenerateDataKey` → 평문 DEK로 암호화, 암호화된 DEK는 `users.dek_wrapped`, KMS 키 ID는 `users.dek_key_id`에 저장.
- 본문: **AES-256-GCM**, 96bit 무작위 nonce, AAD = `fact_id || user_id || sensitivity` (행 바꿔치기 방지). `facts.body_enc = nonce(12) || ciphertext || tag(16)`, `facts.key_id` = 사용한 DEK 식별자(키 회전 시 재암호화 대상 구분).
- 복호화: `KMS Decrypt(users.dek_wrapped)` → 평문 DEK(프로세스 메모리 LRU 캐시, 수 분 TTL) → GCM 복호화. KMS Decrypt 권한은 서비스 역할(ECS 태스크 롤)만 가진다.
- DB CHECK `facts_body_storage`가 "normal이면 평문, sensitive/private이면 암호문+key_id"를 강제하므로 앱 버그로 민감 본문이 평문 저장되는 일을 막는다. 민감도 변경(normal↔sensitive)은 앱이 한 UPDATE에서 두 컬럼을 함께 바꿔야 한다.
- 임베딩: `private`은 임베딩 금지(CHECK). `sensitive`의 임베딩은 원문을 일부 추론할 수 있는 정보이므로, MVP에서는 저장하되 연결 `max_sensitivity`로 검색 결과를 거르고, 필요 시 sensitive는 임베딩 없이 키워드 매칭(복호화 후 메모리)으로 전환하는 옵션을 열어둔다.
- 탈퇴 파기 시 `users` 행 삭제로 `dek_wrapped`도 사라져 백업 속 암호문도 사실상 복호화 불가(crypto-shredding).

## RLS (심층 방어)

- 권한 판단의 원본은 여전히 코어 서비스 한 곳이다. RLS는 "요청이 묶인 사용자 외의 행은 절대 못 건드림"만 보장한다.
- `persona_app` 역할(앱 API): 트랜잭션마다 `SET LOCAL app.user_id = 'usr_...'`. 설정이 없으면 0행이 보인다. 모든 사용자 테이블에 `user_id = app_user_id()` USING/WITH CHECK 정책.
- `persona_service` 역할(`BYPASSRLS`): MCP·OAuth 경로, 로그인(user_id를 아직 모름), 리프레시 회전, 배치 작업. MCP는 토큰 → `connections` 행 조회로 user_id와 범위를 얻은 뒤 코어 서비스가 `persona_ids`/`max_sensitivity`로 거른다. 이후 단계로 MCP도 연결 조회 뒤 `SET LOCAL app.user_id`를 걸고 `persona_app`으로 실행하는 것을 권장.
- 실제 로그인 계정은 `CREATE ROLE api LOGIN IN ROLE persona_app` 식으로 배포 환경에서 만든다(비밀번호는 Secrets Manager).

## `PostgresStore` / repository 전환 계획

`store.ts` 주석대로 라우트는 `CoreService`/`AppService`만 거치므로, 서비스가 쓰는 저장 연산을 인터페이스로 뽑고 두 구현을 둔다.

1. `server/src/core/repo.ts`에 `Repo` 인터페이스(비동기): `users.get/create/softDelete`, `identities.find/link`, `personas.listByUser/get/create/update(id, patch, expectedVersion)/delete/countActive`, `facts.listByPersonas(ids, maxSensitivity)/search(embedding, scope, limit)/create/update/delete`, `connections.get/listByUser/update/revoke`, `accessLogs.append/listByConnection(cursor)`, `interviews.*`, `exports.*`, `authSessions.*`, `refreshTokens.get/markUsed/revokeFamily`, `idempotency.claim/complete`, `withUser(userId, fn)` (트랜잭션 + `SET LOCAL app.user_id`).
2. `MemoryRepo`가 현재 `Store` 맵을 감싸 기존 테스트를 그대로 통과시키고, `PostgresRepo`(`pg` + 커넥션 풀)가 위 스키마를 쓴다. `DATABASE_URL` 유무로 `main.ts`에서 선택.
3. `PostgresRepo` 안에 `FactCipher`(KMS 클라이언트 + DEK 캐시)를 주입: 쓰기 시 sensitivity에 따라 `body_plain`/`body_enc` 선택, 읽기 시 복호화해서 `Fact.body`로 돌려준다. 로컬/테스트는 고정 키 `LocalCipher`.
4. 동시성: `version` 조건부 UPDATE → 0행이면 `version_conflict`. 페르소나 한도는 `SELECT ... FOR UPDATE`로 `users` 행을 잠그고 count 후 insert(경쟁 방지).
5. 페르소나 삭제 시 같은 트랜잭션에서 `UPDATE connections SET persona_ids = array_remove(persona_ids, $1) WHERE user_id = $2 AND $1 = ANY(persona_ids)`.
6. 리프레시 재사용 감지: `UPDATE refresh_tokens SET used = true WHERE hash = $1 AND used = false RETURNING *` — 0행이고 행이 존재하면 family 전체 폐기.
7. 통합 테스트는 docker-compose DB에 `migrate.sh` 후 같은 서비스 테스트를 `PostgresRepo`로 한 번 더 돌린다(“범위 밖 페르소나 절대 미노출” 게이트 포함).
