import type { Store } from "./store.js";
import type { Category, Fact, Sensitivity } from "./types.js";

/** Hardcoded PoC data: one test user with 업무·취미·건강 personas. IDs are fixed so tests and the eval sheet can name them. */
export const TEST_USER_ID = "usr_01J9TESTUSER000000000000";
export const PERSONA_WORK = "per_01J9WORK00000000000000000";
export const PERSONA_HOBBY = "per_01J9HOBBY0000000000000000";
export const PERSONA_HEALTH = "per_01J9HEALTH000000000000000";

const UPDATED = "2026-10-05T02:11:09Z";

export function seed(store: Store): void {
  store.users.set(TEST_USER_ID, { id: TEST_USER_ID, display_name: "테스트 사용자" });

  const personas = [
    {
      id: PERSONA_WORK,
      name: "업무",
      icon: "briefcase",
      summary: "핀테크 백엔드 개발자",
      instructions: "존댓말, 결론 먼저, 코드 예시는 Kotlin으로.",
    },
    {
      id: PERSONA_HOBBY,
      name: "취미",
      icon: "camera",
      summary: "러닝·사진",
      instructions: "편한 말투, 짧게.",
    },
    {
      id: PERSONA_HEALTH,
      name: "건강",
      icon: "heart",
      summary: "알레르기·복용 약 관리",
      instructions: "의학적 조언은 전문가 상담을 함께 권해 주세요.",
    },
  ];
  for (const p of personas) {
    store.personas.set(p.id, { ...p, user_id: TEST_USER_ID, archived: false, updated_at: UPDATED });
  }

  const facts: Array<[string, string, Category, string, Sensitivity]> = [
    ["fct_W01", PERSONA_WORK, "work", "핀테크 스타트업 백엔드 개발자, 경력 6년", "normal"],
    ["fct_W02", PERSONA_WORK, "work", "주력: Kotlin, Spring Boot, PostgreSQL", "normal"],
    ["fct_W03", PERSONA_WORK, "work", "결제 정산 시스템을 MSA로 분리 중 (2026-10 기준)", "normal"],
    ["fct_W04", PERSONA_WORK, "preference", "보고서는 결론 먼저, 불릿 3개 이내 선호", "normal"],
    ["fct_W05", PERSONA_WORK, "interest", "관심 분야: 분산 트랜잭션, 이벤트 소싱", "normal"],
    ["fct_W06", PERSONA_WORK, "finance", "연봉 수준: 업계 평균보다 약간 높음", "sensitive"],
    ["fct_W07", PERSONA_WORK, "finance", "급여 계좌: 국민은행 (번호는 저장 안 함)", "private"],
    ["fct_H01", PERSONA_HOBBY, "interest", "주 3회 러닝, 10km 55분", "normal"],
    ["fct_H02", PERSONA_HOBBY, "interest", "하프 마라톤 첫 완주가 올해 목표", "normal"],
    ["fct_H03", PERSONA_HOBBY, "interest", "필름 카메라로 거리 사진 촬영", "normal"],
    ["fct_H04", PERSONA_HOBBY, "preference", "팟캐스트는 기술·과학 주제 선호", "normal"],
    ["fct_M01", PERSONA_HEALTH, "health", "땅콩 알레르기", "sensitive"],
    ["fct_M02", PERSONA_HEALTH, "health", "비염으로 봄철 항히스타민제 복용", "sensitive"],
    ["fct_M03", PERSONA_HEALTH, "health", "허리 디스크 이력, 무리한 스쿼트 피함", "sensitive"],
  ];
  for (const [id, persona_id, category, body, sensitivity] of facts) {
    const fact: Fact = { id, persona_id, category, body, sensitivity, source: "manual", updated_at: UPDATED };
    store.facts.set(id, fact);
  }
}
