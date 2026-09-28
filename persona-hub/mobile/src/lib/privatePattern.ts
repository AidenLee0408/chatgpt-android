/**
 * Client-side pre-check mirroring the server's fact_private_pattern rule
 * (주민번호·카드번호·계좌번호). The server is authoritative; this only gives
 * instant feedback. Returns the user-facing message or null.
 */
const RULES: { re: RegExp; message: string }[] = [
  { re: /\b\d{6}\s?-\s?[1-4]\d{6}\b/, message: '주민등록번호처럼 보여요. 이런 정보는 안전을 위해 저장하지 않아요.' },
  { re: /\b(?:\d{4}[\s-]?){3}\d{4}\b/, message: '카드번호처럼 보여요. 이런 정보는 안전을 위해 저장하지 않아요.' },
  { re: /(비밀번호|패스워드|password)\s*[:=]?\s*\S+/i, message: '비밀번호처럼 보여요. 이런 정보는 안전을 위해 저장하지 않아요.' },
];

const ACCOUNT = /\b\d{3,6}-\d{2,6}-\d{2,8}(?:-\d{1,3})?\b/g;
const PHONE = /^01[016789]-/;

/** Bank account: dashed digit groups with 10–14 digits, excluding phone numbers and dates. */
function looksLikeAccount(body: string): boolean {
  for (const m of body.match(ACCOUNT) ?? []) {
    const digits = m.replace(/-/g, '').length;
    if (digits >= 10 && digits <= 14 && !PHONE.test(m)) return true;
  }
  return false;
}

export function detectPrivatePattern(body: string): string | null {
  for (const r of RULES) if (r.re.test(body)) return r.message;
  if (looksLikeAccount(body)) return '계좌번호처럼 보여요. 이런 정보는 안전을 위해 저장하지 않아요.';
  return null;
}
