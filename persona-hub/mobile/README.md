# 페르소나 허브 — 모바일 앱 (Expo)

React Native + Expo SDK 57, TypeScript, expo-router. Talks to the `/v1` app API in `../server`.

## Run

```bash
cd persona-hub/server && ALLOW_DEV_LOGIN=1 npm start          # http://localhost:3000
cd persona-hub/mobile && npm install
EXPO_PUBLIC_DEV_LOGIN=1 npx expo start                        # i / a / w
```

On a physical device `localhost` is the phone — set `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000/v1`.
Android emulator: `http://10.0.2.2:3000/v1`.

| Env var | Default | Meaning |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000/v1` | API base URL (include `/v1`) |
| `EXPO_PUBLIC_DEV_LOGIN` | unset | `1` → all three social buttons call `POST /auth/login {provider:"dev", id_token:<per-install id>}` (server needs `ALLOW_DEV_LOGIN=1`). Otherwise the buttons show a "준비 중" toast — real Kakao/Apple/Google SDKs are not wired yet. |

Checks: `npm run typecheck` · `npm run export:web` · `npx expo-doctor`.
`expo-local-authentication` and `expo-secure-store` need a dev build for full behaviour (`npx expo run:ios|android`); Expo Go works for everything else. On web, step-up skips the biometric prompt and tokens use localStorage (dev only).

## Structure

```
src/
  app/                    expo-router routes (screens only)
    _layout.tsx           providers + AuthGate (login → onboarding → tabs)
    (auth)/login.tsx      S-01
    onboarding/           full-screen stack outside tabs
      intro.tsx           S-02 가치 소개 3장
      consent.tsx         S-03 개인정보 동의 → PATCH /me/consents
      templates.tsx       S-04 → POST /interviews
      interview/[id].tsx  S-05 (one question per screen; each answer saved immediately)
      review/[id].tsx     S-06 extract → edit → commit
    (tabs)/               페르소나 · 연결 · 활동 · 설정
      personas/index.tsx  S-07
      personas/[id].tsx   S-08
    facts/edit.tsx        S-09 (modal; ?personaId=&factId=)
    context-pack.tsx      S-10 (modal; ?personaId=)
  api/                    typed /v1 client
    types.ts              wire types (snake_case), aligned with server/src/api/v1.ts
    client.ts             request(): Idempotency-Key, If-Match, refresh-once, step-up
    endpoints.ts          api.* 1:1 wrappers
    hooks.ts              React Query hooks + query keys (qk)
    tokenStore.ts         expo-secure-store tokens, device id, onboarding flag
  components/             design-system components (index.ts re-exports)
  theme/                  tokens.ts (names = design guide) + ThemeProvider/useTheme/Text
  copy/labels.ts          sensitivity/category/source labels + icons
  lib/privatePattern.ts   client pre-check mirroring fact_private_pattern
  state/                  session (auth status) + QueryClient
```

## Conventions

- **Tokens**: `useTheme()` → `t.color.bg.base`, `t.color.sensitivity.private`, `t.color.persona[3]`, `t.type.title`, `t.spacing`, `t.radius.card`, `t.layout.screenPadding`. No shadows: 1px `t.color.border` (8%).
- **Text**: always `<Text variant tone>` from `src/theme` (font scaling on, capped at 200%).
- **Screens**: wrap in `<Screen footer={…}>`; draw loading (`SkeletonList`), empty (`EmptyState`), error (`ErrorState` / `InlineBanner`) states.
- **Sensitivity** is never color-only: use `SensitivityBadge` / `SensitivitySegment`.
- **Buttons say the result** ("팩트 삭제", "연결 끊기"). Irreversible actions go through `ConfirmSheet` with `danger`.
- **Errors**: every failure is an `ApiError {status, code, message, field}`; `errorMessage(e)` gives Korean copy. Server `message` is user-safe.
- **Step-up** is automatic: a 401 `step_up_required` triggers biometric → `POST /auth/step-up` → retry with `X-Step-Up-Token` (cached 5 min). If the user cancels, the call rejects with code `step_up_cancelled`.
- **Concurrency**: pass `version` on PATCH (→ `If-Match`); handle `version_conflict` by refetching.

## 휴대폰에 설치해서 써 보기 (안드로이드 APK)

EAS 클라우드 빌드로 설치 파일을 만듭니다. Android Studio는 필요 없습니다.

1. https://expo.dev 에서 무료 계정을 만든 뒤, 이 폴더에서 로그인합니다.
   ```bash
   npx eas-cli@latest login
   ```
2. APK를 빌드합니다. 약 10~20분 걸리고, 처음에는 프로젝트 연결과 서명 키 생성을 물어보면 모두 Yes를 누르면 됩니다.
   ```bash
   npx eas-cli@latest build -p android --profile preview
   ```
3. 끝나면 나오는 링크나 QR 코드로 휴대폰에서 APK를 받아 설치합니다. "출처를 알 수 없는 앱" 설치를 허용해야 합니다.
4. PC에서 서버를 켭니다. PC와 휴대폰은 같은 와이파이여야 합니다.
   ```bash
   cd ../server && npm install && ALLOW_DEV_LOGIN=1 npm start
   ```
5. 앱 로그인 화면의 **서버 주소**에 `http://<PC의 내부 IP>:3000`을 넣고 로그인합니다.
   - **카카오로 시작하기**: 새 계정으로 온보딩부터 시작합니다.
   - **체험 계정으로 둘러보기**: 업무·취미·건강 페르소나가 미리 있는 계정입니다.

참고
- `preview` 빌드는 개발용입니다. 개발 로그인이 켜져 있고, 로컬 서버를 위해 http 통신을 허용합니다. 운영 빌드에서는 둘 다 꺼야 합니다.
- 서버는 메모리 저장소라 서버를 끄면 데이터가 초기화됩니다.
- iPhone 설치에는 Apple Developer 계정(연 $99)이 필요합니다. 그 전에는 Expo Go로 써 보세요(위 "실행" 참고).
