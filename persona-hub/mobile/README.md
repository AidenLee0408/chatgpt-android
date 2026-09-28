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
