# 페르소나 허브 — PoC (0단계)

기능명세서·API/MCP 명세·디자인 가이드 기준 **2주 PoC** 구현체. 질문은 하나: "실제 Claude·ChatGPT 모바일에서 우리 MCP가 붙고, AI가 알아서 페르소나를 쓰는가?"

| 경로 | 담당 | 내용 |
|---|---|---|
| `server/src/core` | 리드 | 타입, 시드(업무·취미·건강), **유일한 권한 필터**(범위 × 민감도, private 절대 미노출) |
| `server/src/oauth` | OAuth | OAuth 2.1 인가 서버: 메타데이터, DCR, PKCE(S256), W-01 로그인, W-02 동의 화면, 리프레시 회전·재사용 감지 |
| `server/src/mcp` | MCP | Streamable HTTP `/mcp`, 보호 리소스 메타데이터, `list_personas`·`get_persona`·`search_facts` (스키마 v0.1) |
| `server/src/app` | 리드 | 앱 API 대역: 연결 목록·범위 변경·해제·접근 로그 |
| `server/test` | QA | 권한 CI 게이트 + 전체 OAuth→MCP E2E |
| `docs/POC_RUNBOOK.md` | QA | 스테이징 배포, 클라이언트 매트릭스, 20문항 평가, 결과표 |

```bash
cd server && npm install
npm test            # 권한 게이트 + E2E
npm start           # http://localhost:3000  (BASE_URL, TEST_USER_PASSWORD, APP_TOKEN)
npm run poc:report  # 클라이언트별 호출 수·p95
```

PoC 한정 결정: 인메모리 저장소, 단일 테스트 사용자, 검색은 바이그램 점수(MVP에서 pgvector로 교체, 필터 동일), NestJS 대신 Express(MVP 착수 시 재검토).
