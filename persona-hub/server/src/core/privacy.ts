/**
 * F-04 비공개 등급 보호: 서버에 저장하면 안 되는 값(주민등록번호·카드번호·계좌번호·비밀번호)을
 * 팩트 본문에서 감지한다. 순수 함수 — I/O 없음. false positive 보다 false negative 를 조금 더 허용하되,
 * 전형적인 형태는 확실히 막는다.
 */

export type PrivatePatternKind = "rrn" | "card" | "account" | "password";

export interface PrivatePatternMatch {
  kind: PrivatePatternKind;
  /** 사용자에게 그대로 보여줄 한국어 메시지. */
  message: string;
}

export const PRIVATE_PATTERN_MESSAGES: Record<PrivatePatternKind, string> = {
  rrn: "주민등록번호처럼 보여요. 이런 정보는 저장하지 않아요.",
  card: "카드번호처럼 보여요. 이런 정보는 저장하지 않아요.",
  account: "계좌번호처럼 보여요. 이런 정보는 저장하지 않아요.",
  password: "비밀번호처럼 보여요. 이런 정보는 저장하지 않아요.",
};

/** Luhn checksum over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// ---------- normalization (M-7) ----------

const FORMAT_CHARS = /\p{Cf}/gu;
const ND = /\p{Nd}/u;

/** Maps any Unicode decimal digit (Arabic-Indic, Devanagari, …) to ASCII by locating the zero of its run. */
function asciiDigit(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (cp >= 48 && cp <= 57) return ch;
  let start = cp;
  while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start--;
  return String((cp - start) % 10);
}

/** NFKC → strip format chars (ZWSP/ZWJ/BOM/soft hyphen…) → every \p{Nd} to ASCII. */
export function normalizeForDetection(text: string): string {
  return text.normalize("NFKC").replace(FORMAT_CHARS, "").replace(/\p{Nd}/gu, asciiDigit);
}

const KO_DIGITS: Record<string, string> = { 공: "0", 영: "0", 일: "1", 이: "2", 삼: "3", 사: "4", 오: "5", 육: "6", 륙: "6", 칠: "7", 팔: "8", 구: "9" };
/** Separators allowed between digits: whitespace, dashes (hyphen, en/em dash, minus…), _ . · / \ — at most 3 in a row. */
const SEP_CHARS = "\\s\\-‐‑‒–—―−_.·/\\\\";
const S = `[${SEP_CHARS}]{0,3}`;
const KO_RUN = new RegExp(`[공영일이삼사오육륙칠팔구](?:${S}[공영일이삼사오육륙칠팔구]){5,}`, "g");

/** Copy where runs of ≥6 Korean digit words (구공공일공일…) become ASCII digits. Only runs are mapped to limit false positives. */
function mapKoreanDigitRuns(text: string): string {
  return text.replace(KO_RUN, (run) => run.replace(/[공영일이삼사오육륙칠팔구]/g, (c) => KO_DIGITS[c]));
}

// 주민등록번호/외국인등록번호: YYMMDD[1-8]XXXXXX, up to 3 separator chars between any two digits.
const RRN = new RegExp(
  `(?<!\\d)\\d${S}\\d${S}(?:0${S}[1-9]|1${S}[0-2])${S}(?:0${S}[1-9]|[12]${S}\\d|3${S}[01])${S}[1-8](?:${S}\\d){6}(?!\\d)`,
);
// Digit run (card/account candidates): digits joined by ≤3 separators.
const DIGIT_RUN = new RegExp(`(?<!\\d)\\d(?:${S}\\d){7,40}(?!\\d)`, "g");
const BANKS = "국민|신한|우리|하나|농협|기업|카카오\\s*뱅크|토스\\s*뱅크|케이\\s*뱅크|새마을|우체국|씨티|수협|부산|대구|경남|광주|전북|제주|산업|신협|(?<![a-z])(?:SC|KB|IBK|NH)(?![a-z])";
const ACCOUNT_KEYWORD = new RegExp(`(계좌|통장|입금|송금|은행|뱅크|account|acct|iban|${BANKS})`, "i");
const PHONE_DIGITS = /^0(?:1[016789]\d{7,8}|2\d{7,8}|[3-6][1-5]\d{7,8}|70\d{8}|50\d{8,9})$/;
const DASHED_ACCOUNT = new RegExp(`^\\d{2,6}[\\-‐-―−.]\\d{2,6}[\\-‐-―−.]\\d{2,8}(?:[\\-‐-―−.]\\d{1,3})?$`);

const PASSWORD_KEYWORD =
  "(?:비\\s*밀\\s*번\\s*호|비\\s*번|패\\s*스\\s*워\\s*드|암\\s*호|(?<![a-z])(?:password|passwd|passcode|pwd|pw|pin)(?![a-z])|핀\\s*번\\s*호)";
// Explicit connector ("비밀번호: x", "비밀번호는 헌터이", "password is hunter", "pw=x") → any token.
const PASSWORD_EXPLICIT = new RegExp(`${PASSWORD_KEYWORD}\\s*(?:[:=]|은|는|\\s(?:is|was)\\b)\\s*[:=]?\\s*[^\\s,.]{3,}`, "i");
// No connector ("비번1234!", "암호 q1w2e3r4") → only tokens mixing digits or symbols.
const PASSWORD_IMPLICIT = new RegExp(`${PASSWORD_KEYWORD}\\s*(?=[^\\s,.]*[\\d!@#$%^&*])[^\\s,.]{4,}`, "i");

function detectNormalized(text: string): PrivatePatternKind | null {
  const rrn = RRN.exec(text);
  if (rrn) {
    // 1002-123-456789 is also RRN-shaped; a bank-style 3-group number whose first group isn't 6 digits is an account.
    const raw = rrn[0].trim();
    return DASHED_ACCOUNT.test(raw) && !/^\d{6}\D/.test(raw) ? "account" : "rrn";
  }
  const runs = [...text.matchAll(DIGIT_RUN)].map((m) => m[0]);
  for (const raw of runs) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return "card";
  }
  const hasAccountKeyword = ACCOUNT_KEYWORD.test(text);
  for (const raw of runs) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 16) continue;
    if (PHONE_DIGITS.test(digits)) continue;
    if (hasAccountKeyword) return "account";
    if (DASHED_ACCOUNT.test(raw.trim())) return "account";
  }
  if (PASSWORD_EXPLICIT.test(text) || PASSWORD_IMPLICIT.test(text)) return "password";
  return null;
}

export function detectPrivatePattern(body: string): PrivatePatternMatch | null {
  const text = normalizeForDetection(body);
  const kind = detectNormalized(text) ?? detectNormalized(mapKoreanDigitRuns(text));
  return kind ? { kind, message: PRIVATE_PATTERN_MESSAGES[kind] } : null;
}

export const REDACTION_MARKER = "[비공개 정보라 저장하지 않았어요]";

/**
 * M-8: removes private-looking content from free text before it is stored. Line/sentence
 * segments that match are replaced by REDACTION_MARKER; if the whole text matches but no
 * single segment does (the value spans a split point), the whole text is replaced.
 */
export function redactPrivatePatterns(text: string): { text: string; redacted: number } {
  if (!detectPrivatePattern(text)) return { text, redacted: 0 };
  let redacted = 0;
  const parts = text.split(/((?:\r?\n)+|(?<=[.!?。])\s+)/);
  const out = parts.map((p, i) => {
    if (i % 2 === 1 || !p.trim() || !detectPrivatePattern(p)) return p;
    redacted++;
    return REDACTION_MARKER;
  }).join("");
  if (redacted === 0 || detectPrivatePattern(out)) return { text: REDACTION_MARKER, redacted: 1 };
  return { text: out, redacted };
}
