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

// 주민등록번호/외국인등록번호: YYMMDD-[1-8]XXXXXX (구분자 선택)
const RRN = /(?<!\d)(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\s*[-–]?\s*[1-8]\d{6}(?!\d)/;
// 숫자 덩어리(공백/하이픈 허용) — 카드·계좌 후보
const DIGIT_RUN = /(?<![\d-])\d(?:[ -]?\d){7,22}(?![\d])/g;
const ACCOUNT_KEYWORD = /(계좌|통장|입금|송금|account|acct|iban)/i;
const PHONE = /^0(1[016789]|2|[3-6][1-5]|70|50\d?)[ -]?\d{3,4}[ -]?\d{4}$/;
const PASSWORD_KEYWORD = "(비밀\\s?번호|비번|패스워드|암호|password|passwd|passcode|pwd|pw|pin(?:\\s?번호)?)";
// "비밀번호: xxx" / "password=xxx" — 명시적 구분자면 어떤 토큰이든
const PASSWORD_EXPLICIT = new RegExp(`${PASSWORD_KEYWORD}\\s*[:=]\\s*\\S{3,}`, "i");
// "비밀번호는 abc123" / "비번 1234" — 숫자나 기호가 섞인 토큰일 때만
const PASSWORD_IMPLICIT = new RegExp(`${PASSWORD_KEYWORD}\\s*(?:은|는|이|가|을|를)?\\s+(?=\\S*[\\d!@#$%^&*])[^\\s,.]{4,}`, "i");

export function detectPrivatePattern(body: string): PrivatePatternMatch | null {
  const text = body.normalize("NFKC");
  const hit = (kind: PrivatePatternKind): PrivatePatternMatch => ({ kind, message: PRIVATE_PATTERN_MESSAGES[kind] });

  if (RRN.test(text)) return hit("rrn");

  const runs = [...text.matchAll(DIGIT_RUN)].map((m) => m[0]);
  for (const raw of runs) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return hit("card");
  }

  const hasAccountKeyword = ACCOUNT_KEYWORD.test(text);
  for (const raw of runs) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 16) continue;
    if (PHONE.test(raw.trim())) continue;
    // "계좌 110-123-456789" or a 3+ group dashed number such as 1002-123-456789
    if (hasAccountKeyword) return hit("account");
    if (/^\d{2,6}-\d{2,6}-\d{2,8}(-\d{1,3})?$/.test(raw)) return hit("account");
  }

  if (PASSWORD_EXPLICIT.test(text) || PASSWORD_IMPLICIT.test(text)) return hit("password");
  return null;
}
