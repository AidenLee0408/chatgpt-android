import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setSessionExpiredHandler, tokenStore } from '../api';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: SessionStatus;
  /** New user who hasn't finished 가치 소개·동의 yet → AuthGate keeps them in onboarding. */
  onboardingPending: boolean;
  setOnboardingPending: (v: boolean) => void;
}

const SessionContext = createContext<SessionValue>({ status: 'loading', onboardingPending: false, setOnboardingPending: () => {} });
export const useSession = () => useContext(SessionContext);

/** Tracks whether we hold tokens. Auth routing lives in src/app/_layout.tsx. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [onboardingPending, setPending] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([tokenStore.getAccess(), tokenStore.getOnboardingPending()]).then(([t, pending]) => {
      if (!alive) return;
      setPending(pending);
      setStatus(t ? 'signedIn' : 'signedOut');
    });
    const unsub = tokenStore.subscribe((signedIn) => {
      if (!signedIn) return setStatus('signedOut');
      void tokenStore.getOnboardingPending().then((pending) => {
        setPending(pending);
        setStatus('signedIn');
      });
    });
    setSessionExpiredHandler(() => setStatus('signedOut'));
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  const setOnboardingPending = useCallback((v: boolean) => {
    setPending(v);
    void tokenStore.setOnboardingPending(v);
  }, []);
  const value = useMemo(() => ({ status, onboardingPending, setOnboardingPending }), [status, onboardingPending, setOnboardingPending]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
