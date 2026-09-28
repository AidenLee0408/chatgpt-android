import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '../theme';

/** Checkbox row with 48dp target. */
export function Checkbox({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      accessibilityHint={description}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: t.layout.minTouch, paddingVertical: 8, opacity: disabled ? 0.5 : 1 }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: checked ? t.color.brand.primary : t.color.text.secondary,
          backgroundColor: checked ? t.color.brand.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {checked ? <Feather name="check" size={16} color={t.color.brand.onPrimary} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{label}</Text>
        {description ? (
          <Text variant="caption" tone="secondary">
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Generic single-select chips (category, length...). */
export function ChipGroup<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            style={{
              minHeight: t.layout.minTouch,
              paddingHorizontal: 16,
              justifyContent: 'center',
              borderRadius: t.radius.button,
              borderWidth: 1,
              borderColor: selected ? t.color.brand.primary : t.color.border,
              backgroundColor: selected ? t.color.brand.primary : t.color.bg.surface,
            }}
          >
            <Text variant="body" style={{ color: selected ? t.color.brand.onPrimary : t.color.text.primary }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height: 6, borderRadius: 3, backgroundColor: t.color.skeleton, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: t.color.brand.primary }} />
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
      <Text variant="headline" accessibilityRole="header">
        {title}
      </Text>
      {action}
    </View>
  );
}
