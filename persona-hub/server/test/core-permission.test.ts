/**
 * CI 게이트: "범위 밖 페르소나·비공개 팩트 절대 미노출"
 * CoreService 단독(seed 데이터) 권한 통합 테스트. OAuth/MCP 모듈에 의존하지 않는다.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  CoreService, Store, seed, TEST_USER_ID, PERSONA_WORK, PERSONA_HOBBY, PERSONA_HEALTH,
  type Connection, type Sensitivity,
} from "../src/core/index.js";

const OTHER_USER = "usr_OTHER";
const OTHER_PERSONA = "per_OTHERUSER";
let store: Store;
let core: CoreService;

function connect(persona_ids: string[], max_sensitivity: Exclude<Sensitivity, "private"> = "normal", user_id = TEST_USER_ID): Connection {
  return core.createConnection({ user_id, client_id: "cli_test", client_name: "Test Client", persona_ids, max_sensitivity });
}

beforeEach(() => {
  store = new Store();
  seed(store);
  store.users.set(OTHER_USER, { id: OTHER_USER, display_name: "다른 사용자" });
  store.personas.set(OTHER_PERSONA, {
    id: OTHER_PERSONA, user_id: OTHER_USER, name: "타인", icon: "x", summary: "타인 페르소나",
    instructions: "", archived: false, updated_at: "2026-10-05T00:00:00Z",
  });
  store.facts.set("fct_O01", {
    id: "fct_O01", persona_id: OTHER_PERSONA, category: "work", body: "타인 비밀 계좌 알레르기 러닝",
    sensitivity: "normal", source: "manual", updated_at: "2026-10-05T00:00:00Z",
  });
  core = new CoreService(store);
});

const privateIds = () => [...store.facts.values()].filter((f) => f.sensitivity === "private").map((f) => f.id);
const factOwner = (id: string) => store.facts.get(id)!.persona_id;

describe("scope: 업무+취미, max normal", () => {
  test("건강 페르소나는 목록에 없다", () => {
    const c = connect([PERSONA_WORK, PERSONA_HOBBY]);
    const ids = core.listVisiblePersonas(c).map((p) => p.id).sort();
    assert.deepEqual(ids, [PERSONA_HOBBY, PERSONA_WORK].sort());
  });

  test("visiblePersona(health) 는 존재하지 않는 id 와 동일하게 null", () => {
    const c = connect([PERSONA_WORK, PERSONA_HOBBY]);
    const health = core.visiblePersona(c, PERSONA_HEALTH);
    const missing = core.visiblePersona(c, "per_DOESNOTEXIST0000000000000");
    assert.equal(health, null);
    assert.deepEqual(health, missing);
    assert.deepEqual(core.visibleFacts(c, PERSONA_HEALTH), core.visibleFacts(c, "per_DOESNOTEXIST0000000000000"));
    assert.deepEqual(core.visibleFacts(c, PERSONA_HEALTH), []);
  });

  test("normal 에서 sensitive 팩트 미노출", () => {
    const c = connect([PERSONA_WORK, PERSONA_HOBBY]);
    for (const p of core.listVisiblePersonas(c)) {
      for (const f of core.visibleFacts(c, p.id)) assert.equal(f.sensitivity, "normal", f.id);
    }
    assert.ok(!core.visibleFacts(c, PERSONA_WORK).some((f) => f.id === "fct_W06"));
  });

  test("fact_count 는 보이는 팩트 수와 일치", () => {
    const c = connect([PERSONA_WORK, PERSONA_HOBBY]);
    for (const p of core.listVisiblePersonas(c)) assert.equal(p.fact_count, core.visibleFacts(c, p.id).length);
    assert.equal(core.listVisiblePersonas(c).find((p) => p.id === PERSONA_WORK)!.fact_count, 5);
  });

  test("searchFacts 는 범위를 지킨다 (알레르기 → 0건, 건강 personaId 지정해도 0건)", () => {
    const c = connect([PERSONA_WORK, PERSONA_HOBBY]);
    assert.deepEqual(core.searchFacts(c, "알레르기", undefined, 50), []);
    assert.deepEqual(core.searchFacts(c, "알레르기", PERSONA_HEALTH, 50), []);
    assert.deepEqual(core.searchFacts(c, "땅콩 알레르기 약 디스크", PERSONA_HEALTH, 50), []);
    for (const f of core.searchFacts(c, "러닝 Kotlin 연봉 알레르기 계좌", undefined, 50)) {
      assert.ok([PERSONA_WORK, PERSONA_HOBBY].includes(factOwner(f.id)));
      assert.equal(f.sensitivity, "normal");
    }
    assert.ok(core.searchFacts(c, "러닝", undefined, 50).some((f) => f.id === "fct_H01"));
  });
});

describe("sensitive 허용", () => {
  test("sensitive 팩트가 보인다", () => {
    const c = connect([PERSONA_WORK, PERSONA_HOBBY, PERSONA_HEALTH], "sensitive");
    assert.ok(core.visibleFacts(c, PERSONA_WORK).some((f) => f.id === "fct_W06"));
    assert.deepEqual(core.visibleFacts(c, PERSONA_HEALTH).map((f) => f.id).sort(), ["fct_M01", "fct_M02", "fct_M03"]);
    assert.ok(core.searchFacts(c, "알레르기", undefined, 10).some((f) => f.id === "fct_M01"));
  });
});

describe("private 팩트는 어떤 설정에서도 미노출", () => {
  const all = [PERSONA_WORK, PERSONA_HOBBY, PERSONA_HEALTH];
  const subsets: string[][] = [];
  for (let m = 1; m < 8; m++) subsets.push(all.filter((_, i) => m & (1 << i)));

  for (const ids of subsets) {
    for (const max of ["normal", "sensitive"] as const) {
      test(`personas=[${ids.map((i) => i.slice(9, 13)).join(",")}] max=${max}`, () => {
        const c = connect(ids, max);
        const priv = new Set(privateIds());
        assert.ok(priv.size > 0);
        const seen = [
          ...all.flatMap((p) => core.visibleFacts(c, p)),
          ...core.searchFacts(c, "계좌", undefined, 100),
          ...core.searchFacts(c, "급여 계좌 국민은행 번호", undefined, 100),
          ...all.flatMap((p) => core.searchFacts(c, "계좌", p, 100)),
          ...core.searchFacts(c, "알레르기", undefined, 100),
        ];
        for (const f of seen) {
          assert.ok(!priv.has(f.id), `private fact leaked: ${f.id}`);
          assert.notEqual(f.sensitivity, "private");
          assert.ok(ids.includes(f.persona_id), `out-of-scope fact: ${f.id}`);
          if (max === "normal") assert.equal(f.sensitivity, "normal");
        }
      });
    }
  }

  test("런타임에 max_sensitivity='private' 가 들어와도 private 미노출", () => {
    const c = connect(all, "private" as never);
    assert.ok(!core.searchFacts(c, "계좌", undefined, 100).some((f) => f.sensitivity === "private"));
    assert.ok(!core.visibleFacts(c, PERSONA_WORK).some((f) => f.sensitivity === "private"));
  });
});

describe("범위 변경·해제", () => {
  test("updateScope 는 다음 호출에 즉시 반영", () => {
    const c = connect([PERSONA_WORK, PERSONA_HOBBY]);
    assert.ok(core.visiblePersona(c, PERSONA_HOBBY));
    const u = core.updateScope(c.id, TEST_USER_ID, { persona_ids: [PERSONA_WORK], max_sensitivity: "normal" });
    assert.ok(u);
    const live = core.activeConnection(c.id)!;
    assert.equal(core.visiblePersona(live, PERSONA_HOBBY), null);
    assert.deepEqual(core.listVisiblePersonas(live).map((p) => p.id), [PERSONA_WORK]);
    assert.deepEqual(core.searchFacts(live, "러닝", undefined, 10), []);
    core.updateScope(c.id, TEST_USER_ID, { persona_ids: [PERSONA_WORK], max_sensitivity: "sensitive" });
    assert.ok(core.visibleFacts(core.activeConnection(c.id)!, PERSONA_WORK).some((f) => f.id === "fct_W06"));
  });

  test("다른 사용자는 updateScope/revoke 불가", () => {
    const c = connect([PERSONA_WORK]);
    assert.equal(core.updateScope(c.id, OTHER_USER, { persona_ids: [OTHER_PERSONA], max_sensitivity: "sensitive" }), null);
    assert.equal(core.revokeConnection(c.id, OTHER_USER), false);
    assert.ok(core.activeConnection(c.id));
  });

  test("해제된 연결 → activeConnection null, 이후 updateScope 불가", () => {
    const c = connect([PERSONA_WORK, PERSONA_HOBBY]);
    assert.equal(core.revokeConnection(c.id, TEST_USER_ID), true);
    assert.equal(core.activeConnection(c.id), null);
    assert.equal(core.updateScope(c.id, TEST_USER_ID, { persona_ids: [PERSONA_WORK], max_sensitivity: "normal" }), null);
    assert.equal(core.activeConnection("con_nonexistent"), null);
  });
});

describe("타 사용자 데이터 격리", () => {
  test("createConnection 에서 타인 페르소나 id 제거", () => {
    const c = connect([PERSONA_WORK, OTHER_PERSONA]);
    assert.deepEqual(c.persona_ids, [PERSONA_WORK]);
    assert.equal(core.visiblePersona(c, OTHER_PERSONA), null);
    assert.ok(!core.searchFacts(c, "타인 비밀 계좌 알레르기 러닝", undefined, 100).some((f) => f.id === "fct_O01"));
  });

  test("updateScope 에서 타인 페르소나 id 제거", () => {
    const c = connect([PERSONA_WORK]);
    const u = core.updateScope(c.id, TEST_USER_ID, { persona_ids: [OTHER_PERSONA, PERSONA_HOBBY], max_sensitivity: "normal" })!;
    assert.deepEqual(u.persona_ids, [PERSONA_HOBBY]);
  });

  test("persona_ids 가 오염되어도 visiblePersona 가 user_id 로 차단", () => {
    const c = connect([PERSONA_WORK]);
    c.persona_ids.push(OTHER_PERSONA);
    assert.equal(core.visiblePersona(c, OTHER_PERSONA), null);
    assert.deepEqual(core.visibleFacts(c, OTHER_PERSONA), []);
  });

  test("listAccessLogs 는 본인 연결 로그만", () => {
    const mine = connect([PERSONA_WORK]);
    const theirs = connect([OTHER_PERSONA], "normal", OTHER_USER);
    const base = { client_name: "t", tool: "list_personas", persona_ids: [], fact_ids: [], latency_ms: 1 };
    core.recordAccess({ ...base, connection_id: mine.id });
    core.recordAccess({ ...base, connection_id: theirs.id });
    core.recordAccess({ ...base, connection_id: mine.id });
    const logs = core.listAccessLogs(TEST_USER_ID);
    assert.equal(logs.length, 2);
    assert.ok(logs.every((l) => l.connection_id === mine.id));
    assert.deepEqual(core.listAccessLogs(TEST_USER_ID, theirs.id), []);
    assert.equal(core.listAccessLogs(OTHER_USER).length, 1);
    assert.ok(core.activeConnection(mine.id)!.last_accessed_at);
  });
});

describe("보관(archived) 페르소나", () => {
  test("범위에 있어도 숨김", () => {
    const c = connect([PERSONA_WORK, PERSONA_HOBBY], "sensitive");
    store.personas.get(PERSONA_HOBBY)!.archived = true;
    assert.equal(core.visiblePersona(c, PERSONA_HOBBY), null);
    assert.deepEqual(core.listVisiblePersonas(c).map((p) => p.id), [PERSONA_WORK]);
    assert.deepEqual(core.searchFacts(c, "러닝", undefined, 10), []);
    assert.ok(!core.listUserPersonas(TEST_USER_ID).some((p) => p.id === PERSONA_HOBBY));
  });
});
