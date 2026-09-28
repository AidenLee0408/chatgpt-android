import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Tokens live in expo-secure-store (Keychain / Keystore). On web (dev only)
 * secure-store is unavailable, so we fall back to in-memory + localStorage.
 */
const KEYS = { access: 'ph.access_token', refresh: 'ph.refresh_token', device: 'ph.device_id', onboarding: 'ph.onboarding_pending' } as const;

const mem = new Map<string, string>();
const webStorage: Storage | undefined =
  Platform.OS === 'web' && typeof localStorage !== 'undefined' ? localStorage : undefined;

async function get(key: string): Promise<string | null> {
  if (mem.has(key)) return mem.get(key) ?? null;
  let v: string | null = null;
  try {
    v = webStorage ? webStorage.getItem(key) : await SecureStore.getItemAsync(key);
  } catch {
    v = null;
  }
  if (v != null) mem.set(key, v);
  return v;
}

async function set(key: string, value: string | null): Promise<void> {
  if (value == null) mem.delete(key);
  else mem.set(key, value);
  try {
    if (webStorage) {
      if (value == null) webStorage.removeItem(key);
      else webStorage.setItem(key, value);
    } else if (value == null) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  } catch {
    // keep in-memory copy; next launch will require login
  }
}

type Listener = (signedIn: boolean) => void;
const listeners = new Set<Listener>();

export const tokenStore = {
  getAccess: () => get(KEYS.access),
  getRefresh: () => get(KEYS.refresh),
  async setTokens(access: string, refresh: string) {
    await Promise.all([set(KEYS.access, access), set(KEYS.refresh, refresh)]);
    listeners.forEach((l) => l(true));
  },
  async clear() {
    await Promise.all([set(KEYS.access, null), set(KEYS.refresh, null)]);
    listeners.forEach((l) => l(false));
  },
  /** Stable per-install id; used as the dev-login id_token. */
  async getDeviceId(): Promise<string> {
    const existing = await get(KEYS.device);
    if (existing) return existing;
    const id = `dev-${randomId()}`;
    await set(KEYS.device, id);
    return id;
  },
  /** "1" while a new user hasn't finished S-02/S-03. Survives relaunch. */
  getOnboardingPending: async () => (await get(KEYS.onboarding)) === '1',
  setOnboardingPending: (v: boolean) => set(KEYS.onboarding, v ? '1' : null),
  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export function randomId(): string {
  // RFC4122 v4-ish; good enough for idempotency keys & device ids.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
