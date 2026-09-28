/**
 * Design tokens — names match the design guide / Figma variables 1:1.
 * Guide notation `color.bg.base` → code `color.bg.base` on the theme object.
 * Hex values are the guide's "제안" values; finalize at branding.
 */

export type ColorScheme = 'light' | 'dark';

export interface ColorTokens {
  bg: { base: string; surface: string };
  text: { primary: string; secondary: string; inverse: string };
  brand: { primary: string; onPrimary: string };
  sensitivity: { normal: string; sensitive: string; private: string };
  /** color.persona.1..8 — pastel in light, darker tone of the same hue in dark. */
  persona: Record<PersonaColorIndex, string>;
  /** Accent (foreground) for each persona color, readable on the persona tone. */
  personaOn: Record<PersonaColorIndex, string>;
  /** 1px / 8% border used instead of shadows. */
  border: string;
  danger: string;
  scrim: string;
  skeleton: string;
}

export type PersonaColorIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const PERSONA_COLOR_INDICES: PersonaColorIndex[] = [1, 2, 3, 4, 5, 6, 7, 8];

const personaLight: Record<PersonaColorIndex, string> = {
  1: '#DCE4FF', // blue
  2: '#D8F0E0', // green
  3: '#FFE3D1', // apricot
  4: '#F3DDF7', // lilac
  5: '#FFF1C2', // butter
  6: '#D5F0F2', // teal
  7: '#FADADD', // rose
  8: '#E6E3DA', // stone
};
const personaDark: Record<PersonaColorIndex, string> = {
  1: '#2A3560',
  2: '#21432E',
  3: '#5A3522',
  4: '#46294D',
  5: '#4D421A',
  6: '#1F4447',
  7: '#552A30',
  8: '#3D3A33',
};
const personaOnLight: Record<PersonaColorIndex, string> = {
  1: '#2B3F99', 2: '#1F6B3A', 3: '#8A4212', 4: '#6E2E80',
  5: '#6B5400', 6: '#1C6469', 7: '#8C2F3C', 8: '#4F4A3E',
};
const personaOnDark: Record<PersonaColorIndex, string> = {
  1: '#C9D4FF', 2: '#BCE8CB', 3: '#FFD0B3', 4: '#EBC8F2',
  5: '#FFE89A', 6: '#B8EDF0', 7: '#FFC7CE', 8: '#E0DBCD',
};

export const colors: Record<ColorScheme, ColorTokens> = {
  light: {
    bg: { base: '#F7F7F5', surface: '#FFFFFF' },
    text: { primary: '#1A1A1A', secondary: '#6B6B6B', inverse: '#FFFFFF' },
    brand: { primary: '#3B5BDB', onPrimary: '#FFFFFF' },
    sensitivity: { normal: '#2F9E44', sensitive: '#E67700', private: '#C92A2A' },
    persona: personaLight,
    personaOn: personaOnLight,
    border: 'rgba(0,0,0,0.08)',
    danger: '#C92A2A',
    scrim: 'rgba(0,0,0,0.4)',
    skeleton: '#ECECE8',
  },
  dark: {
    bg: { base: '#121213', surface: '#1C1C1E' },
    text: { primary: '#F2F2F2', secondary: '#A0A0A0', inverse: '#121213' },
    brand: { primary: '#6C8BFF', onPrimary: '#0B1233' },
    sensitivity: { normal: '#51CF66', sensitive: '#FFA94D', private: '#FF6B6B' },
    persona: personaDark,
    personaOn: personaOnDark,
    border: 'rgba(255,255,255,0.08)',
    danger: '#FF6B6B',
    scrim: 'rgba(0,0,0,0.6)',
    skeleton: '#2A2A2D',
  },
};

export interface TypeToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
}

/** type.display / title / headline / body / caption / label */
export const type = {
  display: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
} as const satisfies Record<string, TypeToken>;
export type TypeVariant = keyof typeof type;

/** Spacing scale 4 / 8 / 12 / 16 / 24 / 32 / 48. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
/** Screen horizontal margin 20, card inner padding 16. */
export const layout = { screenPadding: 20, cardPadding: 16, minTouch: 48 } as const;

/** radius.card16 / button12 / badge8 / sheet24 */
export const radius = { card: 16, button: 12, badge: 8, sheet: 24 } as const;

export const border = { width: 1 } as const;

export const motion = { fast: 200, normal: 250, slow: 300 } as const;
