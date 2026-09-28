import { View } from 'react-native';
import { Text, useTheme } from '../../theme';

/** Placeholder AI logo: first letter on a tinted circle until brand assets land. */
export function ClientLogo({ name, size = 44 }: { name: string; size?: number }) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.color.bg.base,
        borderWidth: 1,
        borderColor: t.color.border,
      }}
    >
      <Text variant="headline" tone="brand">
        {(name.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}
