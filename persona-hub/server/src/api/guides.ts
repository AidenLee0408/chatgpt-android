/** Server-managed connect guides (GET /v1/connect-guides). {MCP_URL} is substituted per deployment. */
export interface ConnectGuide {
  client: "claude" | "chatgpt" | "gemini";
  name: string;
  requirements: string;
  supported: boolean;
  steps: string[];
  note?: string;
}

export const CONNECT_GUIDES: ConnectGuide[] = [
  {
    client: "claude",
    name: "Claude",
    requirements: "Claude Pro 이상 요금제",
    supported: true,
    steps: [
      "PC나 모바일 웹에서 claude.ai에 로그인해요.",
      "설정 → 커넥터(Connectors)로 이동해요.",
      "‘커스텀 커넥터 추가’를 누르고 이름에 ‘페르소나 허브’를 입력해요.",
      "URL 칸에 {MCP_URL} 을 붙여넣고 추가를 눌러요.",
      "‘연결’을 누르면 페르소나 허브 로그인 화면이 열려요. 로그인 후 공유할 페르소나와 최대 민감도를 골라요.",
      "연결이 끝나면 Claude 모바일 앱에서도 같은 계정으로 바로 쓸 수 있어요.",
    ],
  },
  {
    client: "chatgpt",
    name: "ChatGPT",
    requirements: "ChatGPT Plus 이상, 개발자 모드 켜기",
    supported: true,
    steps: [
      "PC 웹에서 chatgpt.com에 로그인해요.",
      "설정 → 앱 및 커넥터 → 고급 설정에서 ‘개발자 모드’를 켜요.",
      "‘커넥터 만들기’를 누르고 이름에 ‘페르소나 허브’를 입력해요.",
      "MCP 서버 URL에 {MCP_URL} 을 붙여넣고, 인증 방식은 OAuth를 골라요.",
      "페르소나 허브 로그인 화면에서 로그인한 뒤 공유 범위를 골라 승인해요.",
      "대화창의 ‘+’ 메뉴에서 페르소나 허브를 켜고 사용해요. 모바일 앱에도 자동으로 반영돼요.",
    ],
  },
  {
    client: "gemini",
    name: "Gemini",
    requirements: "커스텀 MCP 연결을 지원하는 Gemini 계정(베타)",
    supported: false,
    steps: [
      "Gemini의 커스텀 MCP 연결은 아직 일부 계정에만 열려 있어요.",
      "지원되는 계정이라면 설정 → 연결된 앱에서 {MCP_URL} 을 추가해요.",
      "지원되지 않으면 ‘컨텍스트 팩 복사’로 내 정보를 붙여넣어 쓸 수 있어요.",
    ],
    note: "F-13(v1)에서 정식 지원 예정",
  },
];
