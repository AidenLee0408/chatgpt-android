/** Runtime config from EXPO_PUBLIC_* env vars (inlined at bundle time). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/v1').replace(/\/+$/, '');

/** When "1", all social login buttons use POST /auth/login {provider:"dev"}. */
export const DEV_LOGIN = process.env.EXPO_PUBLIC_DEV_LOGIN === '1';
