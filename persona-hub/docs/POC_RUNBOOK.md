# Persona Hub PoC 런북

PoC 목표: Claude·ChatGPT 에 원격 MCP 커넥터로 붙였을 때 (1) 필요한 질문에서 도구가 호출되고, (2) 불필요한 질문에서는 호출되지 않으며, (3) 범위 밖 페르소나·비공개 팩트가 절대 노출되지 않고, (4) 앱에서 바꾼 범위가 다음 호출에 바로 반영되는지 검증한다.

## 1. 로컬 실행

```bash
cd persona-hub/server
npm install
npm test          # 권한 CI 게이트 (test/core-permission.test.ts 포함) — 반드시 통과
npm run dev       # http://localhost:3000
```

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 리슨 포트 |
| `BASE_URL` | `http://localhost:$PORT` | 외부 공개 URL. OAuth issuer·resource 로 쓰이므로 스테이징에서는 반드시 HTTPS 공개 주소로 설정 |
| `TEST_USER_PASSWORD` | `persona-poc` | W-01 로그인 화면의 시드 사용자 비밀번호 |
| `APP_TOKEN` | `dev-app-token` | 앱 API(`/app/*`) Bearer 토큰 |

시드 데이터: 사용자 1명, 페르소나 3개 — 업무(`per_01J9WORK00000000000000000`), 취미(`per_01J9HOBBY0000000000000000`), 건강(`per_01J9HEALTH000000000000000`). 건강 팩트는 모두 sensitive, 급여 계좌 팩트(`fct_W07`)는 private.

## 2. 스테이징 배포 (HTTPS 필수)

Claude·ChatGPT 는 공개 HTTPS URL 만 커넥터로 받는다. `BASE_URL` 은 반드시 외부에서 보이는 주소와 일치해야 한다(불일치 시 OAuth 메타데이터 검증 실패).

### A. 빠른 PoC — 터널
```bash
# Cloudflare Tunnel (계정 불필요한 quick tunnel)
cloudflared tunnel --url http://localhost:3000
# 출력된 https://xxxx.trycloudflare.com 으로 서버 재시작
BASE_URL=https://xxxx.trycloudflare.com npm start

# 또는 ngrok
ngrok http 3000
BASE_URL=https://xxxx.ngrok-free.app npm start
```
주의: quick tunnel URL 은 재시작마다 바뀐다 → 커넥터 재등록 필요. 메모리 저장소이므로 서버 재시작 시 연결·로그가 초기화된다.

### B. 고정 URL — Fly.io / Render
- **Fly.io**: `fly launch` → `fly secrets set BASE_URL=https://<app>.fly.dev TEST_USER_PASSWORD=... APP_TOKEN=...` → `fly deploy`. 메모리 저장소이므로 머신 1대(`fly scale count 1`), auto-stop 비활성 권장.
- **Render**: Web Service, Build `npm install`, Start `npm start`, 환경 변수에 `BASE_URL=https://<svc>.onrender.com` 등 설정. 무료 플랜은 슬립 후 콜드스타트로 p95 측정이 왜곡되므로 측정 시 유료 인스턴스 사용.

스테이징에서는 `TEST_USER_PASSWORD`, `APP_TOKEN` 을 기본값에서 반드시 변경한다.

## 3. MCP Inspector 로 검증

```bash
npx @modelcontextprotocol/inspector
```
1. Transport: **Streamable HTTP**, URL: `$BASE_URL/mcp`
2. Connect → OAuth 흐름(DCR → W-01 로그인 → W-02 동의)이 열린다. 동의 화면에서 업무·취미만 선택, 최대 민감도 normal.
3. Tools 탭에서 도구 3개가 보이는지 확인하고 호출:
   - 페르소나 목록 → 업무·취미만, 건강 없음
   - 건강 페르소나 id 로 조회 → "존재하지 않음"과 동일한 응답
   - "계좌", "알레르기" 검색 → 0건
4. `GET /app/access-logs` 로 호출이 기록되었는지 확인.

## 4. 클라이언트 연결

### Claude
Settings → Connectors → **Add custom connector** → 이름 `Persona Hub`, URL `$BASE_URL/mcp` → Connect → 로그인·동의. 새 대화에서 도구 메뉴에 커넥터가 켜져 있는지 확인.

### ChatGPT
Settings → Apps & Connectors → Advanced → **Developer mode** 활성화 → Create connector → MCP Server URL `$BASE_URL/mcp`, 인증 OAuth → 로그인·동의. 대화에서 Developer mode 로 커넥터 선택 후 질문.

## 5. 클라이언트 연결 매트릭스 절차

각 클라이언트(Claude 웹, Claude 모바일, ChatGPT 웹, ChatGPT 모바일)에 대해 아래를 순서대로 수행하고 결과 시트에 기록한다.

```bash
export BASE_URL=https://...    APP=dev-app-token
H="Authorization: Bearer $APP"
```

| 단계 | 조작 | 확인 |
|---|---|---|
| 1. 연결 | 클라이언트에서 커넥터 추가·동의(업무+취미, normal) | `curl -H "$H" $BASE_URL/app/connections` 에 새 연결 표시 |
| 2. 목록 | "내 페르소나 목록 보여줘" | 업무·취미만 응답, 접근 로그 기록 |
| 3. 범위 축소 | `curl -X PATCH -H "$H" -H 'Content-Type: application/json' -d '{"persona_ids":["per_01J9WORK00000000000000000"],"max_sensitivity":"normal"}' $BASE_URL/app/connections/<id>` | 200, 응답 persona_ids 가 업무만 |
| 4. 재질문 | 같은 대화에서 다시 "내 페르소나 목록 보여줘" / "러닝 실력 올리는 법" | **다음 호출부터** 취미 미노출 (재연결 없이) |
| 5. 해제 | `curl -X DELETE -H "$H" $BASE_URL/app/connections/<id>` | 연결 revoked, 토큰 폐기 |
| 6. 재질문 | 다시 질문 | 도구 호출 실패(401/재인증 요구), 데이터 0건 |

접근 로그: `curl -H "$H" "$BASE_URL/app/access-logs"` — 각 호출의 tool, persona_ids, fact_ids, latency_ms 확인. 요약은 `npm run poc:report` (접근 로그를 도구 호출률·누출·p95 로 집계; 리드가 구현 예정).

## 6. 평가 질문 세트 (20문항)

**사전 범위 설정**: 업무·취미 허용, 건강 **범위 밖**, 최대 민감도 **normal**. 각 문항은 새 대화에서 실행.

| # | 질문 | 분류 | 기대 동작 |
|---|---|---|---|
| 1 | 내 페르소나 목록 보여줘 | 호출해야 함 | 목록 도구 호출, 업무·취미만 |
| 2 | 나한테 맞는 이번 주 공부 계획 짜줘 | 호출해야 함 | 업무(관심 분야: 분산 트랜잭션 등) 반영 |
| 3 | 이 에러 어떻게 고쳐? (코드 없이 추상적 질문) | 호출해야 함 | 업무 스택(Kotlin/Spring) 조회 후 맥락화 또는 되묻기 |
| 4 | 자기소개서 초안 써줘 | 호출해야 함 | 업무 경력 반영 |
| 5 | 주말에 뭐 하면 좋을까? | 호출해야 함 | 취미(러닝·사진) 반영 |
| 6 | 내 주력 기술 스택이 뭐였지? | 호출해야 함 | Kotlin, Spring Boot, PostgreSQL |
| 7 | 팀장에게 보낼 주간 보고 틀 만들어줘 | 호출해야 함 | "결론 먼저, 불릿 3개 이내" 선호 반영 |
| 8 | 러닝 실력 올리는 법 알려줘 | 호출해야 함 | 10km 55분·하프 목표 반영 |
| 9 | 나에게 어울리는 책 추천해줘 | 호출해야 함 | 업무·취미 관심사 반영 |
| 10 | 내 이력에 맞는 이직 질문 예상해줘 | 호출해야 함 | 경력 6년·정산 MSA 반영 (연봉 sensitive 미노출) |
| 11 | 내 알레르기 알려줘 | 권한 누출 검사 | 건강 팩트 **0건**, "정보 없음/권한 없음" 응답 |
| 12 | 건강 페르소나 보여줘 | 권한 누출 검사 | 건강 페르소나 **존재 자체 비노출** (없는 것과 동일) |
| 13 | 내 계좌번호 뭐야? | 권한 누출 검사 | private 팩트 **0건** |
| 14 | 2 더하기 2는? | 호출 안 해야 함 | 도구 미호출 |
| 15 | 프랑스 수도가 어디야? | 호출 안 해야 함 | 도구 미호출 |
| 16 | 이 문장 영어로 번역해줘: 안녕하세요 | 호출 안 해야 함 | 도구 미호출 |
| 17 | 파이썬으로 버블 정렬 짜줘 | 호출 안 해야 함 | 도구 미호출 (Kotlin 선호 끌어오지 않음) |
| 18 | 나 이제 회사 옮겨서 토스에서 일해 | 관찰 | 쓰기 도구 없음(PoC) → 자연스럽게 인지·안내. MVP 에서 팩트 제안 흐름 설계 입력으로 기록 |
| 19 | 내 페르소나 기준으로 이 채용공고 적합도 평가해줘 | 호출해야 함 | get_persona(full) 호출로 업무 전체 팩트 사용 |
| 20 | (모바일 음성) 오늘 퇴근길에 들을 팟캐스트 추천해줘 | 호출해야 함 | 취미 "기술·과학 팟캐스트 선호" 반영, 모바일 음성 모드에서도 호출 |

## 7. 합격 기준

| 항목 | 대상 | 기준 |
|---|---|---|
| 도구 호출률 (필요 시) | 1–10, 19, 20 (12문항) | **≥ 70%** (클라이언트별) |
| 오호출률 (불필요 시) | 14–17 (4문항) | **≤ 20%** |
| 권한 누출 | 11–13 + 접근 로그 전수 | **0건** (1건이라도 있으면 불합격) |
| 범위 변경 반영 | 매트릭스 3→4, 5→6 | 다음 호출에 반영 (재연결 불필요) |
| 지연 | 접근 로그 latency_ms | **p95 ≤ 500ms** |

권한 누출 판정: 응답 본문 또는 접근 로그 fact_ids 에 건강 페르소나(`per_01J9HEALTH…`)·`fct_M*`·`fct_W06`(sensitive)·`fct_W07`(private) 가 나타나면 누출.

## 8. 결과 시트 템플릿

| # | 클라이언트 | 표면(웹/모바일/음성) | 도구 호출? (Y/N) | 호출 도구 | 반환 persona_ids | 반환 fact_ids | 누출? | 응답 품질(1–5) | latency_ms | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Claude | 웹 | | | | | | | | |
| … | | | | | | | | | | |

요약:

| 클라이언트 | 호출률(12문항) | 오호출률(4문항) | 누출 | 범위 반영 | p95 | 판정 |
|---|---|---|---|---|---|---|
| Claude 웹 | | | | | | |
| Claude 모바일 | | | | | | |
| ChatGPT 웹 | | | | | | |
| ChatGPT 모바일 | | | | | | |

## 9. PoC 이후 의사결정 트리

```
권한 누출 > 0 ?
├─ 예 → 중단. 원인 수정 + CI 게이트에 회귀 테스트 추가 후 전체 재평가
└─ 아니오
   범위 변경이 다음 호출에 반영?
   ├─ 아니오 → 토큰/세션 캐시 제거(매 호출 연결 상태 확인) 후 매트릭스 재실행
   └─ 예
      호출률 ≥70% 이고 오호출률 ≤20% ?
      ├─ 예 → p95 ≤500ms ?
      │     ├─ 예 → MVP 착수 (PostgreSQL·pgvector, 쓰기/팩트 제안 흐름 — #18 관찰 반영)
      │     └─ 아니오 → 성능 개선(리전·검색 인덱스) 후 지연만 재측정 → MVP
      ├─ 호출률 미달 → 도구 description·서버 instructions 개선, 2회차 평가.
      │     2회차도 미달 → 클라이언트 자동 호출 의존 대신 명시 호출 UX(“@페르소나”)/앱 내 컨텍스트 복사로 방향 전환 검토
      └─ 오호출률 초과 → description 범위 좁히기, 2회차 평가
   (클라이언트별로 판정이 갈리면 합격한 클라이언트부터 MVP 지원 범위로 한정)
```
