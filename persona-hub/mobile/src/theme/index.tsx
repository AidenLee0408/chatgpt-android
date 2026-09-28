import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Text as RNText, useColorScheme, type TextProps } from 'react-native';
import {
  border,
  colors,
  layout,
  motion,
  radius,
  spacing,
  type,
  type ColorScheme,
  type ColorTokens,
  type PersonaColorIndex,
  type TypeVariant,
} from './tokens';

export * from './tokens';

export interface Theme {
  scheme: ColorScheme;
  color: ColorTokens;
  type: typeof type;
  spacing: typeof spacing;
  radius: typeof radius;
  layout: typeof layout;
  border: typeof border;
  motion: typeof motion;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const scheme: ColorScheme = system === 'dark' ? 'dark' : 'light';
  const value = useMemo<Theme>(
    () => ({ scheme, color: colors[scheme], type, spacing, radius, layout, border, motion }),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used inside <ThemeProvider>');
  return t;
}

/** Stable persona color index (1..8) from a persona id when the server doesn't provide one. */
export function personaColorIndex(seed: string, explicit?: number | null): PersonaColorIndex {
  if (explicit && explicit >= 1 && explicit <= 8) return explicit as PersonaColorIndex;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ((h % 8) + 1) as PersonaColorIndex;
}

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  tone?: 'primary' | 'secondary' | 'brand' | 'danger' | 'inverse';
}

/** Text bound to type tokens. Font scaling stays enabled (Dynamic Type up to 200%). */
export function Text({ variant = 'body', tone = 'primary', style, ...rest }: AppTextProps) {
  const t = useTheme();
  const color =
    tone === 'secondary'
      ? t.color.text.secondary
      : tone === 'brand'
        ? t.color.brand.primary
        : tone === 'danger'
          ? t.color.danger
          : tone === 'inverse'
            ? t.color.text.inverse
            : t.color.text.primary;
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={2}
      {...rest}
      style={[t.type[variant], { color }, style]}
    />
  );
}
