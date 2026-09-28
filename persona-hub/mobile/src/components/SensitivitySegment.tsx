import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { SENSITIVITIES, type Sensitivity } from '../api/types';
import { SENSITIVITY_META } from '../copy/labels';
import { Text, useTheme } from '../theme';

export interface SensitivitySegmentProps {
  value: Sensitivity;
  onChange: (v: Sensitivity) => void;
  /** e.g. connection scope excludes 'private'. */
  options?: Sensitivity[];
  disabled?: boolean;
  /** Show the one-line description of the selected level under the segment. */
  showDescription?: boolean;
}

/** 일반 / 민감 / 비공개 3-way segment. */
export function SensitivitySegment({ value, onChange, options = SENSITIVITIES, disabled, showDescription = true }: SensitivitySegmentProps) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="민감도"
        style={{
          flexDirection: 'row',
          borderRadius: t.radius.button,
          borderWidth: 1,
          borderColor: t.color.border,
          backgroundColor: t.color.bg.surface,
          padding: 4,
          gap: 4,
        }}
      >
        {options.map((opt) => {
          const selected = opt === value;
          const meta = SENSITIVITY_META[opt];
          const c = t.color.sensitivity[opt];
          return (
            <Pressable
              key={opt}
              disabled={disabled}
              onPress={() => onChange(opt)}
              accessibilityRole="radio"
              accessibilityLabel={`${meta.label}: ${meta.description}`}
              accessibilityState={{ selected, disabled: !!disabled }}
              style={{
                flex: 1,
                minHeight: t.layout.minTouch,
                borderRadius: t.radius.button - 4,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 6,
                borderWidth: selected ? 1.5 : 0,
                borderColor: c,
                backgroundColor: selected ? t.color.bg.base : 'transparent',
              }}
            >
              <Feather name={meta.icon} size={16} color={selected ? c : t.color.text.secondary} />
              <Text variant="body" style={{ color: selected ? c : t.color.text.secondary, fontWeight: selected ? '600' : '400' }}>
                {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {showDescription ? (
        <Text variant="caption" tone="secondary">
          {SENSITIVITY_META[value].description}
        </Text>
      ) : null}
    </View>
  );
}
