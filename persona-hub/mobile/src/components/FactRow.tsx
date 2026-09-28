import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import type { Fact } from '../api/types';
import type { IconName } from '../copy/labels';
import { CATEGORY_META, SOURCE_META } from '../copy/labels';
import { Text, useTheme } from '../theme';
import { SensitivityBadge } from './SensitivityBadge';

export interface FactRowProps {
  fact: Pick<Fact, 'id' | 'category' | 'body' | 'sensitivity' | 'source'>;
  onEdit?: () => void;
  onDelete?: () => void;
  showCategory?: boolean;
}

/**
 * One fact line: sensitivity badge, source icon (직접/인터뷰/AI), edit/delete.
 * Swipe actions from the guide are exposed as explicit 48dp buttons (accessible
 * alternative; swipe can be layered on later).
 */
export function FactRow({ fact, onEdit, onDelete, showCategory }: FactRowProps) {
  const t = useTheme();
  const src = SOURCE_META[fact.source];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: t.color.border,
      }}
    >
      <View style={{ flex: 1, gap: 6 }}>
        <Text variant="body">{fact.body}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <SensitivityBadge value={fact.sensitivity} />
          {showCategory ? (
            <Text variant="label" tone="secondary">
              {CATEGORY_META[fact.category].label}
            </Text>
          ) : null}
          <View accessible accessibilityLabel={`출처 ${src.label}`} style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            <Feather name={src.icon} size={12} color={t.color.text.secondary} />
            <Text variant="label" tone="secondary">
              {src.label}
            </Text>
          </View>
        </View>
      </View>
      {onEdit ? <IconButton icon="edit-2" label="팩트 편집" onPress={onEdit} /> : null}
      {onDelete ? <IconButton icon="trash-2" label="팩트 삭제" onPress={onDelete} danger /> : null}
    </View>
  );
}

export function IconButton({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: t.layout.minTouch,
        height: t.layout.minTouch,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: t.radius.button,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather name={icon} size={18} color={danger ? t.color.danger : t.color.text.secondary} />
    </Pressable>
  );
}
