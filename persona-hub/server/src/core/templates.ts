import type { Category } from "./types.js";

/** F-03 인터뷰 템플릿 3종(서버 관리 콘텐츠). ID는 고정 — 앱이 딥링크로 쓸 수 있다. */
export interface TemplateQuestion {
  id: string;
  text: string;
  hint: string;
  /** Default category for facts extracted from this answer. */
  category: Category;
}

export interface InterviewTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  persona_defaults: { name: string; icon: string; description: string };
  questions: TemplateQuestion[];
}

export const TEMPLATES: InterviewTemplate[] = [
  {
    id: "tpl_work",
    name: "업무",
    icon: "briefcase",
    description: "직무·기술·일하는 방식을 AI가 알 수 있게 정리해요.",
    persona_defaults: { name: "업무", icon: "briefcase", description: "일할 때의 나" },
    questions: [
      { id: "q_work_role", text: "지금 어떤 일을 하고 계세요? 직무와 회사 분야를 알려주세요.", hint: "예: 핀테크 스타트업 백엔드 개발자", category: "work" },
      { id: "q_work_years", text: "이 일을 한 지 얼마나 되셨나요?", hint: "예: 경력 6년", category: "work" },
      { id: "q_work_skills", text: "주로 쓰는 기술이나 도구는 무엇인가요?", hint: "예: Kotlin, Spring Boot, PostgreSQL", category: "work" },
      { id: "q_work_project", text: "요즘 가장 집중하고 있는 과제는 무엇인가요?", hint: "예: 결제 정산 시스템 MSA 분리", category: "work" },
      { id: "q_work_style", text: "AI가 답할 때 어떤 형식을 선호하세요?", hint: "예: 결론 먼저, 불릿 3개 이내, 존댓말", category: "preference" },
      { id: "q_work_goal", text: "앞으로 1년 동안 이루고 싶은 업무 목표가 있나요?", hint: "예: 테크 리드로 성장", category: "work" },
    ],
  },
  {
    id: "tpl_life",
    name: "개인 생활",
    icon: "home",
    description: "취미·관심사·생활 방식을 정리해요.",
    persona_defaults: { name: "개인 생활", icon: "home", description: "일상 속의 나" },
    questions: [
      { id: "q_life_hobby", text: "요즘 즐기는 취미는 무엇인가요?", hint: "예: 주 3회 러닝, 필름 카메라", category: "interest" },
      { id: "q_life_media", text: "좋아하는 책·영화·팟캐스트 장르를 알려주세요.", hint: "예: SF 소설, 기술 팟캐스트", category: "preference" },
      { id: "q_life_food", text: "음식 취향이나 식단 제한이 있나요?", hint: "예: 매운 음식 좋아함, 채식 지향", category: "preference" },
      { id: "q_life_place", text: "주로 어느 지역에서 생활하세요? (동네 수준까지만)", hint: "예: 서울 성수동", category: "profile" },
      { id: "q_life_weekend", text: "주말은 보통 어떻게 보내세요?", hint: "예: 한강 러닝 후 카페", category: "interest" },
      { id: "q_life_goal", text: "올해 개인적으로 이루고 싶은 목표가 있나요?", hint: "예: 하프 마라톤 완주", category: "interest" },
    ],
  },
  {
    id: "tpl_health",
    name: "건강",
    icon: "heart",
    description: "알레르기·복용 약·운동 제약을 정리해요. 민감 등급으로 추천돼요.",
    persona_defaults: { name: "건강", icon: "heart", description: "건강 관리 정보" },
    questions: [
      { id: "q_health_allergy", text: "알레르기가 있나요?", hint: "예: 땅콩 알레르기", category: "health" },
      { id: "q_health_meds", text: "정기적으로 복용하는 약이 있나요?", hint: "예: 봄철 항히스타민제", category: "health" },
      { id: "q_health_history", text: "AI가 알아야 할 질환이나 부상 이력이 있나요?", hint: "예: 허리 디스크 이력", category: "health" },
      { id: "q_health_exercise", text: "운동할 때 피해야 할 동작이나 제약이 있나요?", hint: "예: 무리한 스쿼트 피함", category: "health" },
      { id: "q_health_sleep", text: "수면이나 생활 리듬은 어떤가요?", hint: "예: 자정 취침, 6시간 수면", category: "health" },
      { id: "q_health_diet", text: "건강 때문에 지키는 식단이 있나요?", hint: "예: 저염식", category: "health" },
      { id: "q_health_goal", text: "건강 관련 목표가 있나요?", hint: "예: 체지방 5% 감량", category: "health" },
    ],
  },
];

export function getTemplate(id: string): InterviewTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
