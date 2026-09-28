import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPrivatePattern, luhnValid, RuleBasedFactExtractor, splitAnswer, renderContextPack } from "../src/core/index.js";

const kind = (s: string) => detectPrivatePattern(s)?.kind ?? null;

test("luhn", () => {
  assert.equal(luhnValid("4111111111111111"), true);
  assert.equal(luhnValid("4111111111111112"), false);
});

test("주민등록번호", () => {
  assert.equal(kind("주민번호 900101-1234567"), "rrn");
  assert.equal(kind("9001012234567"), "rrn");
  assert.equal(detectPrivatePattern("900101-1234567")!.message, "주민등록번호처럼 보여요. 이런 정보는 저장하지 않아요.");
});

test("카드번호 (Luhn 통과만)", () => {
  assert.equal(kind("카드 4111 1111 1111 1111"), "card");
  assert.equal(kind("5500-0000-0000-0004"), "card");
  assert.notEqual(kind("주문번호 4111 1111 1111 1112"), "card");
});

test("계좌번호", () => {
  assert.equal(kind("급여 계좌 110-123-456789"), "account");
  assert.equal(kind("1002-123-456789"), "account");
  assert.equal(kind("국민은행 통장 12345678901234"), "account");
  assert.equal(detectPrivatePattern("계좌 110-123-456789")!.message, "계좌번호처럼 보여요. 이런 정보는 저장하지 않아요.");
});

test("비밀번호", () => {
  assert.equal(kind("비밀번호: hunter2"), "password");
  assert.equal(kind("password=abcd"), "password");
  assert.equal(kind("비번은 qwer1234!"), "password");
});

test("평범한 문장은 통과", () => {
  for (const s of [
    "핀테크 스타트업 백엔드 개발자, Kotlin·Spring 주력",
    "급여 계좌: 국민은행 (번호는 저장 안 함)",
    "주 3회 러닝, 10km 55분",
    "2026-10-05 마라톤 참가",
    "전화 010-1234-5678",
    "비밀번호 관리 앱을 쓰는 편",
    "연봉 6000만원",
  ]) assert.equal(detectPrivatePattern(s), null, s);
});

test("rule-based extractor: split + health/finance → sensitive", async () => {
  assert.deepEqual(splitAnswer("러닝을 해요. 사진도 찍어요\n독서"), ["러닝을 해요", "사진도 찍어요", "독서"]);
  const out = await new RuleBasedFactExtractor().extract([
    { question: { id: "q1", text: "", hint: "", category: "work" }, answer: "백엔드 개발자예요. 연봉은 평균 이상이에요." },
    { question: null, answer: "땅콩 알레르기가 있어요" },
    { question: null, answer: "없어요" },
  ]);
  assert.deepEqual(out.map((f) => [f.category, f.sensitivity]), [["work", "normal"], ["finance", "sensitive"], ["health", "sensitive"]]);
});

test("context pack never renders private and respects short budget", () => {
  const persona = { id: "p", user_id: "u", name: "업무", icon: "", summary: "", instructions: "결론 먼저", archived: false, updated_at: "" };
  const facts = Array.from({ length: 30 }, (_, i) => ({
    id: `f${i}`, persona_id: "p", category: "work" as const, body: `사실 번호 ${i} 에 대한 꽤 긴 설명 문장입니다`,
    sensitivity: (i === 0 ? "private" : "normal") as "private" | "normal", source: "manual" as const, updated_at: "",
  }));
  const short = renderContextPack([{ persona, facts }], "ko", "short");
  assert.ok(short.char_count <= 320, `${short.char_count}`);
  assert.ok(short.omitted_fact_count > 0);
  const full = renderContextPack([{ persona, facts }], "en", "detailed");
  assert.ok(!full.fact_ids.includes("f0"));
  assert.match(full.text, /# Persona: 업무/);
});
