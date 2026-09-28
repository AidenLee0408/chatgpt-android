import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { API_URL } from './config';
import { randomId, tokenStore } from './tokenStore';
import type { ApiErrorBody, ApiErrorCode, StepUpResponse, TokenPair } from './types';

/** Error thrown for every non-2xx response (and network failures). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode | (string & {}),
    message: string,
    public readonly field?: string,
    public readonly requestId?: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  is(code: ApiErrorCode) {
    return this.code === code;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/** Korean fallback copy per error code — server `message` wins when present. */
const FALLBACK_MESSAGE: Record<string, string> = {
  network_error: '연결이 불안정해요. 잠시 후 다시 시도해 주세요.',
  token_expired: '다시 로그인해 주세요.',
  step_up_required: '본인 확인이 필요해요.',
  plan_limit_reached: '무료 플랜은 페르소나를 3개까지 만들 수 있어요.',
  not_found: '찾을 수 없어요. 이미 삭제됐을 수 있어요.',
  version_conflict: '다른 기기에서 먼저 수정했어요. 최신 내용을 불러왔어요.',
  rate_limited: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  internal: '일시적인 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  step_up_cancelled: '본인 확인을 취소했어요.',
};

export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message || FALLBACK_MESSAGE[e.code] || FALLBACK_MESSAGE.internal;
  return FALLBACK_MESSAGE.internal;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Sent as If-Match for optimistic concurrency. */
  version?: number;
  /** Override the auto-generated Idempotency-Key (e.g. keep one per form submission). */
  idempotencyKey?: string;
  /** Skip auth header (login/refresh). */
  anonymous?: boolean;
}

// ---- step-up token cache (5 min per spec) ----
let stepUp: { token: string; expiresAt: number } | null = null;
let stepUpInFlight: Promise<string> | null = null;

/** Invoked when refresh fails → caller should route to login. */
let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

let refreshInFlight: Promise<boolean> | null = null;

function buildUrl(path: string, query?: RequestOptions['query']) {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${API_URL}${path}${qs ? `?${qs}` : ''}`;
}

async function rawFetch(path: string, opts: RequestOptions, extra: Record<string, string>): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': 'ko', ...extra };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!opts.anonymous) {
    const access = await tokenStore.getAccess();
    if (access) headers.Authorization = `Bearer ${access}`;
  }
  if (opts.version !== undefined) headers['If-Match'] = String(opts.version);
  if (stepUp && stepUp.expiresAt > Date.now()) headers['X-Step-Up-Token'] = stepUp.token;
  try {
    return await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', FALLBACK_MESSAGE.network_error);
  }
}

async function toError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const code = body?.error?.code ?? (res.status === 404 ? 'not_found' : res.status === 429 ? 'rate_limited' : 'internal');
  const retry = res.headers.get('Retry-After');
  return new ApiError(
    res.status,
    code,
    body?.error?.message || FALLBACK_MESSAGE[code] || FALLBACK_MESSAGE.internal,
    body?.error?.field,
    body?.error?.request_id,
    retry ? Number(retry) : undefined,
  );
}

async function refreshTokens(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refresh = await tokenStore.getRefresh();
      if (!refresh) return false;
      const res = await rawFetch('/auth/refresh', { method: 'POST', body: { refresh_token: refresh }, anonymous: true }, {});
      if (!res.ok) return false;
      const pair = (await res.json()) as TokenPair;
      await tokenStore.setTokens(pair.access_token, pair.refresh_token);
      return true;
    })()
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/** Biometric prompt → POST /auth/step-up. Resolves with the token or throws ApiError('step_up_cancelled'). */
export async function performStepUp(reason = '민감한 정보를 다루려면 본인 확인이 필요해요'): Promise<string> {
  if (stepUp && stepUp.expiresAt > Date.now()) return stepUp.token;
  if (stepUpInFlight) return stepUpInFlight;
  stepUpInFlight = (async () => {
    // Server accepts method "biometric" only; device-passcode fallback still proves presence.
    // Web (dev only) has no biometric API, so we skip the prompt there.
    if (Platform.OS !== 'web') {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason,
        cancelLabel: '취소',
        fallbackLabel: '기기 암호 사용',
        disableDeviceFallback: false,
      });
      if (!result.success) throw new ApiError(0, 'step_up_cancelled', FALLBACK_MESSAGE.step_up_cancelled);
    }
    const res = await rawFetch('/auth/step-up', { method: 'POST', body: { method: 'biometric' } }, { 'Idempotency-Key': randomId() });
    if (!res.ok) throw await toError(res);
    const data = (await res.json()) as StepUpResponse;
    stepUp = { token: data.step_up_token, expiresAt: Date.now() + (data.expires_in ?? 300) * 1000 - 5000 };
    return data.step_up_token;
  })().finally(() => {
    stepUpInFlight = null;
  });
  return stepUpInFlight;
}

export function clearStepUp() {
  stepUp = null;
}

/**
 * Typed request. Handles:
 *  - Idempotency-Key on mutations (stable across the internal retries below)
 *  - If-Match from `version`
 *  - 401 token_expired → refresh once → retry
 *  - 401 step_up_required → biometric + /auth/step-up → retry with X-Step-Up-Token
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const extra: Record<string, string> = {};
  if (method !== 'GET') extra['Idempotency-Key'] = opts.idempotencyKey ?? randomId();

  let res = await rawFetch(path, opts, extra);
  let refreshed = false;
  let steppedUp = false;

  for (;;) {
    if (res.ok) break;
    const err = await toError(res);
    if (res.status === 401 && err.code === 'token_expired' && !refreshed && !opts.anonymous) {
      refreshed = true;
      if (await refreshTokens()) {
        res = await rawFetch(path, opts, extra);
        continue;
      }
      await tokenStore.clear();
      onSessionExpired();
      throw err;
    }
    if (res.status === 401 && err.code === 'step_up_required' && !steppedUp) {
      steppedUp = true;
      clearStepUp();
      await performStepUp();
      res = await rawFetch(path, opts, extra);
      continue;
    }
    if (res.status === 401 && err.code !== 'step_up_required' && !opts.anonymous) {
      await tokenStore.clear();
      onSessionExpired();
    }
    throw err;
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
