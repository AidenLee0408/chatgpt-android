import { Stack } from 'expo-router';
import { useTheme } from '../../../theme';

export default function PersonasStack() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.color.bg.base },
        headerTintColor: t.color.text.primary,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: t.color.bg.base },
      }}
    >
      <Stack.Screen name="index" options={{ title: '페르소나' }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}
