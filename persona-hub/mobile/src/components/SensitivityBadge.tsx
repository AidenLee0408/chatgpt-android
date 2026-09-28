import { Feather } from '@expo/vector-icons';
import { View } from 'react-native';
import type { Sensitivity } from '../api/types';
import { SENSITIVITY_META } from '../copy/labels';
import { Text, useTheme } from '../theme';

/** Icon + text + color — never color alone (색각이상 대응). */
export function SensitivityBadge({ value, prefix }: { value: Sensitivity; prefix?: string }) {
  const t = useTheme();
  const meta = SENSITIVITY_META[value];
  const c = t.color.sensitivity[value];
  const label = prefix ? `${prefix} ${meta.label}` : meta.label;
  return (
    <View
      accessible
      accessibilityLabel={`민감도 ${label}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: t.radius.badge,
        borderWidth: 1,
        borderColor: c,
        alignSelf: 'flex-start',
      }}
    >
      <Feather name={meta.icon} size={12} color={c} />
      <Text variant="label" style={{ color: c }}>
        {label}
      </Text>
    </View>
  );
}
