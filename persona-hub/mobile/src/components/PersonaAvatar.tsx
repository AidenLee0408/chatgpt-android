import { Feather } from '@expo/vector-icons';
import { View } from 'react-native';
import { personaIcon } from '../copy/labels';
import { personaColorIndex, useTheme } from '../theme';

export function PersonaAvatar({ id, icon, color, size = 40 }: { id: string; icon?: string; color?: number | null; size?: number }) {
  const t = useTheme();
  const idx = personaColorIndex(id, color);
  return (
    <View
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2.5,
        backgroundColor: t.color.persona[idx],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Feather name={personaIcon(icon)} size={size * 0.5} color={t.color.personaOn[idx]} />
    </View>
  );
}
