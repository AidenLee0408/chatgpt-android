import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { useTheme } from '../../theme';

/** Bottom tabs: 페르소나 · 연결 · 활동 · 설정 */
export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.color.brand.primary,
        tabBarInactiveTintColor: t.color.text.secondary,
        tabBarStyle: { backgroundColor: t.color.bg.surface, borderTopColor: t.color.border },
        headerStyle: { backgroundColor: t.color.bg.base },
        headerTintColor: t.color.text.primary,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: t.color.bg.base },
      }}
    >
      <Tabs.Screen
        name="personas"
        options={{ title: '페르소나', headerShown: false, tabBarIcon: ({ color, size }) => <Feather name="users" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="connections"
        options={{ title: '연결', tabBarIcon: ({ color, size }) => <Feather name="link-2" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="activity"
        options={{ title: '활동', tabBarIcon: ({ color, size }) => <Feather name="activity" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: '설정', tabBarIcon: ({ color, size }) => <Feather name="settings" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
