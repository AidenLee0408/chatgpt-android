// M-7 / M-8 regression: every bypass from the SECURITY_REVIEW probe must now be blocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPrivatePattern, normalizeForDetection, redactPrivatePatterns, REDACTION_MARKER } from "../src/core/index.js";
import { start } from "./api-helpers.js";

const kind = (s: string) => detectPrivatePattern(s)?.kind ?? null;

test("normalization: format chars stripped, all Nd digits → ASCII", () => {
  assert.equal(normalizeForDetection("12​3­4﻿"), "1234");
  assert.equal(normalizeForDetection("٩٠٠١٠١"), "900101");
  assert.equal(normalizeForDetection("९००१०१"), "900101");
  assert.equal(normalizeForDetection("９００"), "900");
});

test("RRN bypasses from the probe are blocked", () => {
  for (const s of [
    "900101-1234567", "９００１０１－１２３４５６７",
    "٩٠٠١٠١-١٢٣٤٥٦٧", "९००१०१-१२३४५६७",
    "900101.1234567", "900101/1234567", "900 101 1234567", "900101_1234567",
    "900101—1234567", "900101−1234567", "900101 - 1234567",
    "900101-12​34567", "9‍00101-1234567",
    "주민번호 구공공일공일 일이삼사오육칠", "구공공일공일-일이삼사오육칠",
  ]) assert.equal(kind(s), "rrn", s);
});

test("card bypasses from the probe are blocked", () => {
  for (const s of [
    "4111 1111 1111 1111", "４１１１ １１１１ １１１１ １１１１",
    "4111.1111.1111.1111", "4111_1111_1111_1111", "4111  1111  1111  1111",
    "4111​1111​1111​1111", "4111—1111—1111—1111", "4111/1111/1111/1111",
    "카드 사일일일 일일일일 일일일일 일일일일",
  ]) assert.equal(kind(s), "card", s);
});

test("account: bank names + digit runs", () => {
  for (const s of ["계좌 110-123-456789", "신한 110123-456789", "국민은행 123456789012", "우리 1002.123.456789", "카카오뱅크 3333 01 2345678", "토스뱅크 1000-1234-5678"])
    assert.equal(kind(s), "account", s);
});

test("password variants", () => {
  for (const s of [
    "비밀번호: hunter2", "암호 q1w2e3r4", "비밀번호는 헌터이", "my password is hunter", "비번1234!",
    "비 밀 번 호: abc123", "비밀 번호는 qwerty", "PW: letmein", "password=abcd", "비번은 qwer1234!", "패스워드 : dragon",
  ]) assert.equal(kind(s), "password", s);
});

test("ordinary text still passes", () => {
  for (const s of [
    "010-1234-5678", "전화 010 1234 5678", "2024년 3월 입사", "2026-10-05 마라톤 참가", "주 3회 러닝, 10km 55분",
    "비밀번호 관리 앱을 쓰는 편", "연봉 6000만원", "데이터는 암호화해서 보관해요", "우리 팀은 5명이에요",
    "핀테크 스타트업 백엔드 개발자, Kotlin·Spring 주력", "일이 많아서 이사 오기로 했어요",
  ]) assert.equal(detectPrivatePattern(s), null, s);
});

test("redactPrivatePatterns replaces only matching segments", () => {
  const r = redactPrivatePatterns("연봉을 올리고 싶어요. 급여 계좌 110-123-456789");
  assert.equal(r.redacted, 1);
  assert.match(r.text, /연봉을 올리고 싶어요\./);
  assert.ok(r.text.includes(REDACTION_MARKER));
  assert.ok(!r.text.includes("456789"));
  // Split across a sentence boundary → whole answer is replaced.
  assert.equal(redactPrivatePatterns("번호는 900101. 1234567").text, REDACTION_MARKER);
  assert.deepEqual(redactPrivatePatterns("평범한 답변"), { text: "평범한 답변", redacted: 0 });
});

test("M-8: raw interview answers never store private patterns", async () => {
  const h = await start();
  try {
    const { access_token: t } = await h.login("sec-itv");
    const s = await h.call("/interviews", { token: t, body: { template_id: "tpl_work" } });
    const r = await h.call(`/interviews/${s.body.id}/answers`, {
      token: t, body: { answers: [{ question_id: "q_work_role", text: "개발자예요.\n주민번호 900101.1234567" }] },
    });
    assert.equal(r.status, 200);
    const stored = h.server.store.interviews.get(s.body.id)!.answers[0];
    assert.ok(!stored.text.includes("1234567"), stored.text);
    assert.ok(stored.text.includes(REDACTION_MARKER));
    assert.equal(r.body.redacted_count, 1);
    const ex = await h.call(`/interviews/${s.body.id}/extract`, { token: t, body: {} });
    assert.ok(!ex.body.candidates.some((c: any) => c.body.includes(REDACTION_MARKER)));
    assert.equal(ex.body.blocked.length, 1);
  } finally {
    await h.close();
  }
});
