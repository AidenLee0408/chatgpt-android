# 페르소나 허브 — PoC (0단계)

기능명세서·API/MCP 명세·디자인 가이드 기준 **2주 PoC** 구현체. 질문은 하나: "실제 Claude·ChatGPT 모바일에서 우리 MCP가 붙고, AI가 알아서 페르소나를 쓰는가?"

| 경로 | 담당 | 내용 |
|---|---|---|
| `server/src/core` | 리드 | 타입, 시드(업무·취미·건강), **유일한 권한 필터**(범위 × 민감도, private 절대 미노출) |
| `server/src/oauth` | OAuth | OAuth 2.1 인가 서버: 메타데이터, DCR, PKCE(S256), W-01 로그인, W-02 동의 화면, 리프레시 회전·재사용 감지 |
| `server/src/mcp` | MCP | Streamable HTTP `/mcp`, 보호 리소스 메타데이터, `list_personas`·`get_persona`·`search_facts` (스키마 v0.1) |
| `server/src/app` | 리드 | (PoC 레거시) `/app` 앱 API 대역 — E2E 테스트용으로 유지 |
| `server/src/api` | 백엔드 | **MVP 앱 REST API `/v1`** (30개 엔드포인트, JWT·리프레시 회전·재인증·멱등키·레이트 리밋) |
| `server/test` | QA | 권한 CI 게이트 + 전체 OAuth→MCP E2E |
| `docs/POC_RUNBOOK.md` | QA | 스테이징 배포, 클라이언트 매트릭스, 20문항 평가, 결과표 |

```bash
cd server && npm install
npm test            # 권한 게이트 + E2E
npm start           # http://localhost:3000  (BASE_URL, TEST_USER_PASSWORD, APP_TOKEN)
npm run poc:report  # 클라이언트별 호출 수·p95
```

PoC 한정 결정: 인메모리 저장소, 단일 테스트 사용자, 검색은 바이그램 점수(MVP에서 pgvector로 교체, 필터 동일), NestJS 대신 Express(MVP 착수 시 재검토).

## 앱 REST API `/v1` (MVP)

`docs/specs/api-mcp-poc.txt`의 30개 엔드포인트 구현. 규칙: snake_case, 목록은 `{items, next_cursor}`(limit ≤100, 기본 20),
에러는 `{error:{code,message,field?,request_id}}`, 모든 응답에 `X-Request-Id`, POST/PATCH/DELETE에 `Idempotency-Key`(24h 재생),
페르소나·팩트·연결은 `version` + `If-Match` → 409, 사용자당 분당 120회 → 429 + `Retry-After`.

- 인증: `POST /v1/auth/login {provider, id_token}` → access(HS256 JWT, 15분) + refresh(불투명, 30일, 회전·재사용 시 패밀리 폐기).
  실제 카카오·애플·구글 검증은 `SocialVerifier` 인터페이스 뒤(미구현). 개발용 `provider:"dev"`는 `ALLOW_DEV_LOGIN=1`일 때만, `id_token` 문자열마다 고정 사용자,
  `"test-user"`는 시드 사용자(업무·취미·건강, OAuth 로그인 화면과 같은 계정).
- 재인증: `POST /v1/auth/step-up {method:"biometric"}` → 5분 `X-Step-Up-Token`. **TODO: 기기 증명(App Attest/Play Integrity·패스키) 없이 앱 주장을 신뢰하는 PoC 수준.**
- 비공개 패턴(주민번호·카드(Luhn)·계좌·비밀번호)은 `core/privacy.ts`에서 차단(400 `fact_private_pattern`).
- 인터뷰 추출은 `FactExtractor` 인터페이스, 기본값은 규칙 기반(`RuleBasedFactExtractor`).

```bash
ALLOW_DEV_LOGIN=1 npm start
curl -s localhost:3000/v1/auth/login -H 'content-type: application/json' -d '{"provider":"dev","id_token":"test-user"}'
```

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` / `BASE_URL` | 3000 / `http://localhost:$PORT` | 공개 URL(OAuth issuer, MCP URL, 내보내기 링크) |
| `JWT_SECRET` | 프로세스별 랜덤 | 앱 JWT 서명 키. 운영에서는 필수(없으면 재시작 시 모든 세션 만료) |
| `ALLOW_DEV_LOGIN` | 꺼짐 | `1`이면 `provider:"dev"` 로그인 허용 — 운영 금지 |
| `CORS_ORIGINS` | 없음 | `/v1` 추가 허용 Origin(쉼표 구분) |
| `ALLOW_DEV_CORS` | http BASE_URL 또는 dev 로그인 시 켜짐 | `localhost`/`127.0.0.1` 모든 포트(Expo web :8081 등) 허용 |
| `RATE_LIMIT_PER_MIN` | 120 | 사용자당 분당 요청 수 |
| `TEST_USER_PASSWORD`, `APP_TOKEN` | PoC | OAuth 로그인 화면 비밀번호, 레거시 `/app` 토큰 |
