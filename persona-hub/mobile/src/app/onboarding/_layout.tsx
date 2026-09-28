import { Stack } from 'expo-router';
import { useTheme } from '../../theme';

/** Full-screen onboarding stack, outside the tabs. */
export default function OnboardingLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.color.bg.base },
        headerTintColor: t.color.text.primary,
        headerShadowVisible: false,
        headerTitle: '',
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: t.color.bg.base },
      }}
    >
      <Stack.Screen name="intro" options={{ headerShown: false }} />
    </Stack>
  );
}
