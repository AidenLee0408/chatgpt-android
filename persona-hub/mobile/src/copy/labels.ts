import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { Category, FactSource, Sensitivity } from '../api/types';

export type IconName = ComponentProps<typeof Feather>['name'];

export const SENSITIVITY_META: Record<Sensitivity, { label: string; icon: IconName; description: string }> = {
  normal: { label: '일반', icon: 'check-circle', description: '연결 범위에 포함되면 AI가 볼 수 있어요' },
  sensitive: { label: '민감', icon: 'alert-triangle', description: '"민감 포함"을 켠 연결만 볼 수 있어요' },
  private: { label: '비공개', icon: 'lock', description: '어떤 AI에게도 전달되지 않아요' },
};

export const CATEGORY_META: Record<Category, { label: string; icon: IconName }> = {
  profile: { label: '신상', icon: 'user' },
  work: { label: '직업', icon: 'briefcase' },
  interest: { label: '관심사', icon: 'star' },
  health: { label: '건강', icon: 'heart' },
  finance: { label: '재무', icon: 'dollar-sign' },
  preference: { label: '선호', icon: 'sliders' },
  other: { label: '기타', icon: 'more-horizontal' },
};

export const SOURCE_META: Record<FactSource, { label: string; icon: IconName }> = {
  manual: { label: '직접 입력', icon: 'edit-3' },
  interview: { label: '인터뷰', icon: 'message-circle' },
  ai_suggestion: { label: 'AI 제안', icon: 'cpu' },
  import: { label: '가져오기', icon: 'download' },
};

/** Persona icon keys (server stores a string) → Feather glyph. Unknown keys fall back to 'user'. */
export const PERSONA_ICONS: Record<string, IconName> = {
  work: 'briefcase',
  life: 'home',
  health: 'heart',
  hobby: 'camera',
  study: 'book-open',
  money: 'trending-up',
  family: 'users',
  travel: 'map',
  user: 'user',
};
/** Server icon keys are Feather glyph names (e.g. "briefcase"); aliases above are also accepted. */
export const personaIcon = (key?: string): IconName => {
  if (!key) return 'user';
  if (PERSONA_ICONS[key]) return PERSONA_ICONS[key];
  return key in Feather.glyphMap ? (key as IconName) : 'user';
};
