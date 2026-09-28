import type { ConnectionStatus, Persona, Sensitivity } from '../../api/types';

/** "방금 전", "5분 전", "3시간 전", "2일 전", else yyyy.mm.dd */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '아직 조회 없음';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const s = Math.max(0, Math.round((now - d) / 1000));
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return formatDate(iso);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const STATUS_META: Record<ConnectionStatus, { label: string }> = {
  active: { label: '연결됨' },
  expired: { label: '만료됨' },
  revoked: { label: '해제됨' },
};

/** Scope sensitivities a connection may be granted ('private' never leaves the server). */
export type ScopeSensitivity = Exclude<Sensitivity, 'private'>;
const RANK: Record<ScopeSensitivity, number> = { normal: 0, sensitive: 1 };

/** True when the new scope grants anything the old one didn't → step-up needed. */
export function isWidening(
  prev: { persona_ids: string[]; max_sensitivity: ScopeSensitivity },
  next: { persona_ids: string[]; max_sensitivity: ScopeSensitivity },
): boolean {
  if (RANK[next.max_sensitivity] > RANK[prev.max_sensitivity]) return true;
  const had = new Set(prev.persona_ids);
  return next.persona_ids.some((id) => !had.has(id));
}

export function personaNames(ids: string[], personas: Persona[] | undefined): string[] {
  const map = new Map((personas ?? []).map((p) => [p.id, p.name]));
  return ids.map((id) => map.get(id) ?? '삭제된 페르소나');
}

/** Known AI app deep links. Fallback is the web app. */
export const CLIENT_APPS: Record<string, { scheme: string; web: string }> = {
  claude: { scheme: 'claude://', web: 'https://claude.ai' },
  chatgpt: { scheme: 'chatgpt://', web: 'https://chatgpt.com' },
  gemini: { scheme: 'googlegemini://', web: 'https://gemini.google.com' },
};
export const clientKey = (nameOrId: string) => nameOrId.trim().toLowerCase().replace(/[^a-z]/g, '');
