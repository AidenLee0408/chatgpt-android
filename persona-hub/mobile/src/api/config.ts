/** Runtime config from EXPO_PUBLIC_* env vars (inlined at bundle time). */
export const DEFAULT_API_URL = normalize(process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/v1');

/** When "1", all social login buttons use POST /auth/login {provider:"dev"}. */
export const DEV_LOGIN = process.env.EXPO_PUBLIC_DEV_LOGIN === '1';

/**
 * The server can be changed at runtime in dev builds (login screen), so one
 * installed APK works against whichever PC/tunnel is running the server.
 */
let apiUrl = DEFAULT_API_URL;
export const getApiUrl = () => apiUrl;
export function setApiUrlInMemory(url: string | null) {
  apiUrl = url ? normalize(url) : DEFAULT_API_URL;
}

export function normalize(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(u)) u = `http://${u}`;
  if (!/\/v1$/.test(u)) u = `${u}/v1`;
  return u;
}
