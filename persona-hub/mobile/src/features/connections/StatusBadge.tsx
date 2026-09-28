import { View } from 'react-native';
import type { ConnectionStatus } from '../../api/types';
import { Text, useTheme } from '../../theme';
import { STATUS_META } from './format';

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  const t = useTheme();
  const c =
    status === 'active' ? t.color.sensitivity.normal : status === 'expired' ? t.color.sensitivity.sensitive : t.color.text.secondary;
  return (
    <View
      accessibilityLabel={`상태 ${STATUS_META[status].label}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: t.radius.badge, borderWidth: 1, borderColor: c }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
      <Text variant="label" style={{ color: c }}>
        {STATUS_META[status].label}
      </Text>
    </View>
  );
}
