import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../components';
import { AppLockGate } from '../features/settings/appLock';
import { SessionProvider, useSession } from '../state/session';
import { queryClient } from '../state/queryClient';
import { ThemeProvider, useTheme } from '../theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <ToastProvider>
              <AppLockGate>
                <AuthGate />
              </AppLockGate>
            </ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Auth gate:
 *  - no tokens                          → (auth)/login
 *  - new user (login is_new_user) until S-03 동의 submitted → onboarding
 *  - otherwise                          → (tabs)
 * Onboarding routes are also reachable later (S-04 from the personas tab).
 */
function AuthGate() {
  const t = useTheme();
  const { status, onboardingPending } = useSession();
  const segments = useSegments();
  const router = useRouter();

  const group = segments[0];
  const inAuth = group === '(auth)';
  const inOnboarding = group === 'onboarding';

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'signedOut') {
      if (!inAuth) router.replace('/login');
    } else if (onboardingPending) {
      if (!inOnboarding) router.replace('/onboarding/intro');
    } else if (inAuth) {
      router.replace('/personas');
    }
  }, [status, onboardingPending, inAuth, inOnboarding, router]);

  const header = {
    headerStyle: { backgroundColor: t.color.bg.base },
    headerTintColor: t.color.text.primary,
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: t.color.bg.base },
  };

  return (
    <>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      {status === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.bg.base }}>
          <ActivityIndicator color={t.color.brand.primary} accessibilityLabel="불러오는 중" />
        </View>
      ) : (
        <Stack screenOptions={header}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="facts/edit" options={{ presentation: 'modal', title: '팩트' }} />
          <Stack.Screen name="context-pack" options={{ presentation: 'modal', title: '컨텍스트 팩 복사' }} />
        </Stack>
      )}
    </>
  );
}
