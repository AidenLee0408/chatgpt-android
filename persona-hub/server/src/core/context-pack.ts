import type { Category, Fact, Persona } from "./types.js";

/** F-08 컨텍스트 팩: 커넥터 없는 AI에 붙여넣을 텍스트. 순수 함수. */
export type PackLanguage = "ko" | "en";
export type PackLength = "short" | "normal" | "detailed";

/** Approximate character budgets (spec: 짧게 ≈300자). detailed = no cap. */
export const PACK_BUDGET: Record<PackLength, number> = { short: 300, normal: 1200, detailed: Infinity };

const CATEGORY_LABEL: Record<PackLanguage, Record<Category, string>> = {
  ko: { profile: "신상", work: "직업", interest: "관심사", health: "건강", finance: "재무", preference: "선호", other: "기타" },
  en: { profile: "Profile", work: "Work", interest: "Interests", health: "Health", finance: "Finance", preference: "Preferences", other: "Other" },
};
const CATEGORY_ORDER: Category[] = ["profile", "work", "preference", "interest", "health", "finance", "other"];

const T = {
  ko: {
    intro: "아래는 제 정보예요. 답변할 때 참고해 주세요.",
    persona: (n: string) => `# 페르소나: ${n}`,
    instr: (s: string) => `답변 지시: ${s}`,
    more: (n: number) => `(외 ${n}개 생략)`,
  },
  en: {
    intro: "Here is some context about me (facts are written in my own words). Please use it when answering.",
    persona: (n: string) => `# Persona: ${n}`,
    instr: (s: string) => `Instructions: ${s}`,
    more: (n: number) => `(${n} more omitted)`,
  },
};

export interface PackInput {
  persona: Persona;
  facts: Fact[];
}

/**
 * Renders the pack. Callers must already have filtered facts (private never, sensitive only if opted in);
 * this function drops private defensively as well. For "en", headings are English but fact bodies are
 * kept verbatim (no machine translation in the MVP).
 */
export function renderContextPack(input: PackInput[], language: PackLanguage, length: PackLength) {
  const t = T[language];
  const budget = PACK_BUDGET[length];
  const lines: string[] = [t.intro, ""];
  const used: string[] = [];
  let omitted = 0;
  const size = () => lines.join("\n").length;

  for (const { persona, facts } of input) {
    const header = [t.persona(persona.name)];
    if (persona.instructions && length !== "short") header.push(t.instr(persona.instructions));
    else if (persona.instructions && size() + persona.instructions.length < budget / 2) header.push(t.instr(persona.instructions));
    lines.push(...header);
    const safe = facts.filter((f) => f.sensitivity !== "private");
    const byCat = CATEGORY_ORDER.map((c) => [c, safe.filter((f) => f.category === c)] as const).filter(([, fs]) => fs.length);
    for (const [cat, fs] of byCat) {
      const catLine = length === "short" ? null : `## ${CATEGORY_LABEL[language][cat]}`;
      let wroteCat = false;
      for (const f of fs) {
        const line = `- ${f.body}`;
        if (size() + line.length + (catLine && !wroteCat ? catLine.length + 1 : 0) + 1 > budget) {
          omitted++;
          continue;
        }
        if (catLine && !wroteCat) {
          lines.push(catLine);
          wroteCat = true;
        }
        lines.push(line);
        used.push(f.id);
      }
    }
    lines.push("");
  }
  if (omitted) lines.push(t.more(omitted));
  const text = lines.join("\n").trim();
  return { text, char_count: text.length, fact_ids: used, omitted_fact_count: omitted };
}
