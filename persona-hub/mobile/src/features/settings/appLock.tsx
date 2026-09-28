import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, View } from 'react-native';
import { Button } from '../../components';
import { Text, useTheme } from '../../theme';

const KEY = 'ph.app_lock';
/** Re-lock only after the app was in background at least this long (avoids re-prompting after the OS biometric sheet). */
const GRACE_MS = 30_000;

let cached: boolean | null = null;
const listeners = new Set<(v: boolean) => void>();

export async function getAppLockEnabled(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    cached = Platform.OS === 'web' ? false : (await SecureStore.getItemAsync(KEY)) === '1';
  } catch {
    cached = false;
  }
  return cached;
}

export async function setAppLockEnabled(v: boolean): Promise<void> {
  cached = v;
  listeners.forEach((l) => l(v));
  try {
    if (v) await SecureStore.setItemAsync(KEY, '1');
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // in-memory value still applies this session
  }
}

export function useAppLockSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(cached);
  useEffect(() => {
    let alive = true;
    getAppLockEnabled().then((v) => alive && setEnabled(v));
    listeners.add(setEnabled);
    return () => {
      alive = false;
      listeners.delete(setEnabled);
    };
  }, []);
  return enabled;
}

export async function biometricAvailability(): Promise<{ ok: boolean; reason?: string; label: string }> {
  if (Platform.OS === 'web') return { ok: false, reason: '웹에서는 쓸 수 없어요', label: '생체 인증' };
  const hw = await LocalAuthentication.hasHardwareAsync();
  if (!hw) return { ok: false, reason: '이 기기는 생체 인증을 지원하지 않아요', label: '생체 인증' };
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  const label = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
    ? Platform.OS === 'ios' ? 'Face ID' : '얼굴 인식'
    : Platform.OS === 'ios' ? 'Touch ID' : '지문';
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return { ok: false, reason: `기기 설정에서 ${label}를 먼저 등록해 주세요`, label };
  return { ok: true, label };
}

export async function authenticate(prompt: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: '취소', fallbackLabel: '기기 암호 사용' });
  return r.success;
}

/**
 * Covers the app with a lock screen on cold start and when returning to the
 * foreground (after GRACE_MS) while 생체 잠금 is on. Mount once near the root,
 * inside ThemeProvider — see report: needs the foundation owner to place it.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const t = useTheme();
  const enabled = useAppLockSetting();
  const [locked, setLocked] = useState(false);
  const bgAt = useRef<number | null>(null);
  const prompting = useRef(false);
  const initial = useRef(true);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      if (await authenticate('페르소나 허브 잠금 해제')) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    if (enabled && initial.current) {
      initial.current = false;
      setLocked(true);
      unlock();
    } else if (enabled === false) {
      initial.current = false;
      setLocked(false);
    }
  }, [enabled, unlock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (!enabled) return;
      if (s === 'background') bgAt.current = Date.now();
      else if (s === 'active' && bgAt.current != null) {
        const away = Date.now() - bgAt.current;
        bgAt.current = null;
        if (away >= GRACE_MS && !prompting.current) {
          setLocked(true);
          unlock();
        }
      }
    });
    return () => sub.remove();
  }, [enabled, unlock]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {locked ? (
        <View
          accessibilityViewIsModal
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: t.color.bg.base,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
            gap: 16,
          }}
        >
          <Text variant="title" accessibilityRole="header">
            페르소나 허브가 잠겨 있어요
          </Text>
          <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
            본인 확인 후 열 수 있어요.
          </Text>
          <Button label="잠금 해제" icon="unlock" onPress={unlock} />
        </View>
      ) : null}
    </View>
  );
}
