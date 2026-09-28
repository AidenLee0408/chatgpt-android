import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { start, type Harness } from "./api-helpers.js";

let h: Harness;
before(async () => { h = await start(); });
after(() => h.close());

test("templates: 3 with 5–7 Korean questions", async () => {
  const { access_token: t } = await h.login("i-tpl");
  const r = await h.call("/templates", { token: t });
  assert.deepEqual(r.body.items.map((x: any) => x.name), ["업무", "개인 생활", "건강"]);
  for (const tpl of r.body.items) assert.ok(tpl.questions.length >= 5 && tpl.questions.length <= 7);
  assert.equal(r.body.next_cursor, null);
});

test("interview: start → answers → extract → commit creates persona with interview facts", async () => {
  const { access_token: t } = await h.login("i-flow");
  const start = await h.call("/interviews", { token: t, body: { template_id: "tpl_work" } });
  assert.equal(start.status, 201);
  const id = start.body.id;
  assert.equal(start.body.questions.length, 6);

  assert.equal((await h.call(`/interviews/${id}/extract`, { token: t, body: {} })).status, 400, "no answers yet");

  const ans = await h.call(`/interviews/${id}/answers`, {
    token: t,
    body: {
      answers: [
        { question_id: "q_work_role", text: "핀테크 스타트업 백엔드 개발자예요. 결제 도메인을 맡고 있어요." },
        { question_id: "q_work_skills", text: "Kotlin, Spring Boot\nPostgreSQL" },
        { question_id: "q_work_goal", text: "연봉을 올리고 싶어요. 급여 계좌 110-123-456789" },
      ],
    },
  });
  assert.equal(ans.status, 200);
  assert.equal(ans.body.answers.length, 3);
  // single-answer form also works
  assert.equal((await h.call(`/interviews/${id}/answers`, { token: t, body: { question_id: "q_work_style", text: "결론 먼저" } })).status, 200);
  assert.equal((await h.call(`/interviews/${id}/answers`, { token: t, body: { question_id: "nope", text: "x" } })).status, 400);

  const ex = await h.call(`/interviews/${id}/extract`, { token: t, body: {} });
  assert.equal(ex.status, 200);
  const c = ex.body.candidates as Array<{ body: string; category: string; sensitivity: string }>;
  assert.ok(c.length >= 5, JSON.stringify(c));
  assert.ok(c.some((x) => x.body.includes("Kotlin") && x.sensitivity === "normal"));
  assert.ok(c.some((x) => x.body.includes("연봉") && x.sensitivity === "sensitive" && x.category === "finance"));
  assert.ok(!c.some((x) => x.body.includes("110-123")), "private pattern candidates are dropped");
  assert.equal(ex.body.blocked.length, 1);

  const facts = c.map(({ body, category, sensitivity }) => ({ body, category, sensitivity }));
  const denied = await h.call(`/interviews/${id}/commit`, { token: t, body: { facts } });
  assert.equal(denied.body.error.code, "step_up_required", "sensitive candidates need step-up");

  const su = await h.stepUp(t);
  const commit = await h.call(`/interviews/${id}/commit`, { token: t, headers: { "x-step-up-token": su }, body: { facts } });
  assert.equal(commit.status, 201);
  assert.equal(commit.body.persona.name, "업무");
  assert.equal(commit.body.facts.length, facts.length);
  assert.ok(commit.body.facts.every((f: any) => f.source === "interview"));
  assert.equal(commit.body.persona.fact_count, facts.length);
  assert.equal((await h.call(`/interviews/${id}/commit`, { token: t, headers: { "x-step-up-token": su }, body: { facts } })).status, 400);
});

test("interviews are user-scoped", async () => {
  const a = await h.login("i-a");
  const b = await h.login("i-b");
  const s = await h.call("/interviews", { token: a.access_token, body: { template_id: "tpl_life" } });
  assert.equal((await h.call(`/interviews/${s.body.id}/answers`, { token: b.access_token, body: { question_id: "q_life_hobby", text: "러닝" } })).status, 404);
  assert.equal((await h.call("/interviews", { token: a.access_token, body: { template_id: "tpl_x" } })).status, 400);
});
