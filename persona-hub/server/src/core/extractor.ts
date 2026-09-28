import type { TemplateQuestion } from "./templates.js";
import type { Category, Sensitivity } from "./types.js";
import { detectPrivatePattern } from "./privacy.js";

/** One suggested fact. The user always reviews category/sensitivity before commit (F-03). */
export interface ExtractedFact {
  question_id: string | null;
  category: Category;
  body: string;
  sensitivity: Sensitivity;
}

export interface ExtractInput {
  question: TemplateQuestion | null;
  answer: string;
}

/**
 * Pluggable extraction. The MVP target is an LLM-backed implementation
 * (e.g. an AnthropicFactExtractor calling the Messages API with a JSON schema);
 * swap it in via createServer({ factExtractor }).
 */
export interface FactExtractor {
  extract(inputs: ExtractInput[]): Promise<ExtractedFact[]>;
}

const HEALTH = /(알레르기|복용|약물|질환|질병|병원|진단|디스크|수술|치료|통증|우울|불안|혈압|당뇨|임신|정신|처방|allerg|medic|diagnos|surgery)/i;
const FINANCE = /(연봉|월급|급여|소득|대출|부채|빚|자산|투자|주식|코인|보험|신용|재산|salary|income|debt|loan)/i;
const WORK = /(개발자|디자이너|회사|직무|경력|업무|팀|프로젝트|스타트업|기술|engineer|developer)/i;
const PREFERENCE = /(선호|좋아|싫어|원해|편해|존댓말|반말|형식|prefer)/i;

/** Splits on sentence ends, newlines, bullets and ";" — commas are kept (they usually join one fact). */
export function splitAnswer(answer: string): string[] {
  return answer
    .split(/(?:\r?\n|[.!?。]\s+|[.!?。]$|;|•|·\s|(?:^|\s)-\s)/)
    .map((s) => s.trim().replace(/^[-*]\s*/, "").replace(/[.。]$/, ""))
    .filter((s) => s.length >= 2)
    .map((s) => (s.length > 500 ? s.slice(0, 500) : s));
}

export function suggestCategory(body: string, fallback: Category): Category {
  if (HEALTH.test(body)) return "health";
  if (FINANCE.test(body)) return "finance";
  if (fallback !== "other") return fallback;
  if (WORK.test(body)) return "work";
  if (PREFERENCE.test(body)) return "preference";
  return "other";
}

export function suggestSensitivity(body: string, category: Category): Sensitivity {
  if (detectPrivatePattern(body)) return "private";
  if (category === "health" || category === "finance" || HEALTH.test(body) || FINANCE.test(body)) return "sensitive";
  return "normal";
}

/** Default rule-based extractor: no network, deterministic. */
export class RuleBasedFactExtractor implements FactExtractor {
  async extract(inputs: ExtractInput[]): Promise<ExtractedFact[]> {
    const out: ExtractedFact[] = [];
    const seen = new Set<string>();
    for (const { question, answer } of inputs) {
      if (/^(없(어요|음|습니다)?|아니요|no|none|n\/a)$/i.test(answer.trim())) continue;
      for (const body of splitAnswer(answer)) {
        const key = body.replace(/\s+/g, " ").toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const category = suggestCategory(body, question?.category ?? "other");
        out.push({ question_id: question?.id ?? null, category, body, sensitivity: suggestSensitivity(body, category) });
      }
    }
    return out;
  }
}
