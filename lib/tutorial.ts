// 튜토리얼 단원과 단계
// target  : 화면에서 강조할 요소의 data-tour 값 (없으면 화면 가운데 설명 카드)
// route   : 이 단계를 보여줄 화면. "project" = 프로젝트 상세 화면
// ready   : 이벤트를 보내기 전에 화면에 나타나야 하는 요소
// event   : 화면에 보내는 동작 (탭 전환, 단계 패널 열기 등)
// role    : 이 권한이 있을 때만 보여줌

export type TourRoute = "/" | "/projects/new" | "/templates" | "/admin" | "/departments" | "project";
export type Role = "editor" | "gamepart" | "admin";

export type TourEvent =
  | { type: "tab"; tab: "gantt" | "pm" | "logs" | "settings" }
  | { type: "open-stage" }
  | { type: "close-stage" }
  | { type: "import"; open: boolean };

export interface TourStep {
  target?: string;
  title: string;
  body: string;
  route?: TourRoute;
  ready?: string;
  event?: TourEvent;
  role?: Role;
}

export interface Chapter {
  id: string;
  title: string;
  desc: string;
  minutes: number;
  needsProject?: boolean;
  role?: Role;
  steps: TourStep[];
  /** 단원이 끝날 때 화면 정리 */
  cleanup?: TourEvent[];
}

export const CHAPTERS: Chapter[] = [
  {
    id: "basics",
    title: "화면 둘러보기",
    desc: "대시보드에서 무엇을 볼 수 있는지",
    minutes: 1,
    steps: [
      {
        route: "/",
        title: "환영합니다 👋",
        body: "이 사이트는 기존 'NPD 양식' 구글 시트를 대신합니다.\n시트의 4개 탭이 몇 개의 화면으로 합쳐졌어요.\n\n튜토리얼은 실제 화면을 짚으며 설명하고, 데이터는 바꾸지 않으니 편하게 [다음]을 눌러보세요.",
      },
      {
        route: "/",
        target: "nav",
        title: "상단 메뉴",
        body: "· 대시보드: 모든 프로젝트를 한눈에\n· 부서별 일정: 우리 부서가 담당·협업하는 단계만 모아보기\n· 템플릿: 프로젝트의 기본 단계 구성\n· 사용자 관리: 관리자만 보입니다",
      },
      {
        route: "/",
        target: "tiles",
        title: "오늘의 요약",
        body: "진행 중인 프로젝트 수와, 차질·주의 상태인 단계 수, '확인 필요'가 체크된 단계 수를 보여줍니다.",
      },
      {
        route: "/",
        target: "project-table",
        title: "전체 프로젝트 조망",
        body: "시트의 '전체 프로젝트 조망' 탭입니다. 프로젝트를 만들면 자동으로 여기에 올라옵니다.\n\n· 프로젝트 이름을 누르면 상세 화면으로\n· 예상 완료가 계획보다 늦으면 빨간 '+N일'\n· PM 판단은 이 표에서 바로 바꿀 수 있어요",
      },
      {
        route: "/",
        target: "dash-filter",
        title: "필터",
        body: "[주의·차질·확인필요]를 누르면 손이 가야 하는 프로젝트만 남습니다. 보관한(끝난) 프로젝트는 체크해야 보여요.",
      },
      {
        route: "/",
        target: "attention",
        title: "지금 챙겨야 할 단계",
        body: "모든 프로젝트에서 차질·주의·확인 필요인 단계만 모았습니다. 누르면 그 단계의 상세 화면이 바로 열려요.\n\n아침에 여기만 확인해도 충분합니다.",
      },
      {
        route: "/",
        target: "new-project",
        role: "gamepart",
        title: "새 프로젝트",
        body: "게임파트는 여기서 새 프로젝트를 만듭니다. (3단원에서 자세히)",
      },
      {
        target: "help-btn",
        title: "튜토리얼은 언제든 다시",
        body: "이 버튼으로 언제든 단원을 골라 다시 볼 수 있습니다. 다음 단원 '상태 색깔 읽는 법'으로 가볼까요?",
      },
    ],
  },
  {
    id: "status",
    title: "상태 색깔 읽는 법",
    desc: "정상·주의·차질이 정해지는 규칙",
    minutes: 1,
    steps: [
      {
        title: "자동 상태",
        body: "각 단계의 상태는 날짜를 보고 자동으로 정해집니다.\n\n🔴 차질 — 계획 종료일이 지났는데 아직 완료 안 됨\n🟡 주의 — 예상 완료일이 계획보다 늦음, 또는 시작일이 지났는데 실제 시작일이 비어 있음\n🟢 정상 — 그 외\n⚪ 대기 — 아직 시작 전 / 완료 — 실제 완료일 입력됨",
      },
      {
        title: "PM 판단이 우선",
        body: "자동 상태와 실제 사정이 다르면 PM이 직접 🟢🟡🔴를 고를 수 있어요.\n\n최종 상태 = PM 판단이 있으면 PM 판단, 없으면 자동 상태\n\n(예: 날짜는 지났지만 협의가 끝나 문제없음 → PM 판단 '정상')",
      },
      {
        title: "프로젝트 상태",
        body: "프로젝트의 자동 상태는 단계 중 가장 나쁜 상태를 따릅니다.\n한 단계라도 차질이면 프로젝트도 차질로 보여요.\n\n전체 진행률은 단계별 진행률을 기간 길이로 가중 평균한 값입니다.",
      },
      {
        title: "그래서 해야 할 일은",
        body: "① 단계를 시작하면 '실제 시작일'\n② 늦어질 것 같으면 '예상 완료일'\n③ 끝나면 '실제 완료일' (또는 [오늘 완료 처리] 버튼)\n\n이 세 가지만 채우면 상태가 알아서 맞춰집니다.",
      },
    ],
  },
  {
    id: "new-project",
    title: "새 프로젝트 만들기",
    desc: "템플릿으로 단계 한 번에 만들기",
    minutes: 1,
    role: "gamepart",
    steps: [
      {
        route: "/projects/new",
        target: "np-name",
        title: "프로젝트명",
        body: "예) 2026 하반기 오리지널게임",
      },
      {
        route: "/projects/new",
        target: "np-start",
        title: "프로젝트 시작일 = 1주차",
        body: "시트의 '프로젝트 시작일'과 같습니다. 이 날이 1주차가 되고, 단계의 '3주차부터 4주간' 같은 일정이 여기서부터 계산돼요.",
      },
      {
        route: "/projects/new",
        target: "np-template",
        title: "단계 템플릿",
        body: "공모전형·직접기획형처럼 미리 저장해 둔 단계 구성을 고르면 단계와 일정이 한 번에 만들어집니다.\n\n만든 뒤에도 단계 추가·삭제·일정 수정은 자유롭게 돼요.",
      },
      {
        route: "/projects/new",
        target: "np-preview",
        title: "미리보기",
        body: "시작일과 템플릿을 바꾸면 각 단계가 몇 월 며칠에 잡히는지 바로 보여줍니다.",
      },
      {
        route: "/projects/new",
        target: "np-submit",
        title: "만들기",
        body: "이 버튼을 누르면 실제로 프로젝트가 만들어집니다. 튜토리얼 중에는 누르지 않아도 돼요.",
      },
    ],
  },
  {
    id: "gantt",
    title: "일정(간트) 다루기",
    desc: "막대를 끌어서 일정 바꾸기",
    minutes: 2,
    needsProject: true,
    steps: [
      {
        route: "project",
        target: "proj-summary",
        title: "프로젝트 요약",
        body: "계획 완료일, 현재 예상 완료일(늦어지면 '+N일 지연'), 진행률, 자동→최종 상태를 보여줍니다.",
      },
      {
        route: "project",
        target: "proj-pm",
        title: "프로젝트 PM 판단",
        body: "프로젝트 전체에 대한 PM 판단입니다. '자동'을 고르면 단계 상태를 따라갑니다.",
      },
      {
        route: "project",
        target: "proj-memo",
        title: "PM 메모",
        body: "프로젝트 전체 메모입니다. 대시보드 표에도 보여요. 입력 후 칸 밖을 누르면 자동 저장됩니다.",
      },
      {
        route: "project",
        target: "proj-tabs",
        title: "4개의 탭",
        body: "· 일정(간트): 시트의 'NPD 상세 양식' + '월간 보기'\n· 진행관리: 시트의 'PM 프로젝트 진행관리'\n· 기록: 모든 진행 메모와 변경 이력\n· 설정·권한: 프로젝트 정보, 타부서 편집자",
      },
      {
        route: "project",
        ready: "proj-tabs",
        event: { type: "tab", tab: "gantt" },
        target: "gantt",
        title: "간트 읽는 법",
        body: "한 줄 = 한 단계입니다.\n\n· 회색 막대 = 계획 기간 (색 채움 = 진행률)\n· 아래 검은 선 = 실제 진행\n· 빨간 점선 = 예상 지연 구간\n· 빨간 세로선 = 오늘\n· 왼쪽 점 색깔 = 최종 상태",
      },
      {
        route: "project",
        target: "gantt-bar",
        role: "editor",
        title: "끌어서 일정 바꾸기",
        body: "· 막대 가운데를 끌면 → 일정 이동\n· 막대 양 끝을 끌면 → 시작/종료일 조정\n· 일정이 없는 줄은 빈 칸을 끌어서 새로 그리기\n\n끄는 동안 날짜와 주차가 표시되고, 놓으면 바로 저장되며 '기록'에 변경 이력이 남습니다.",
      },
      {
        route: "project",
        target: "gantt-scale",
        title: "주 / 월 보기",
        body: "[주]는 주차 단위로 자세히, [월]은 긴 프로젝트를 한 화면에. 시트의 '월간 보기' 탭이 이 버튼 하나가 됐어요.",
      },
      {
        route: "project",
        target: "gantt-color",
        title: "부서별 색",
        body: "[색: 부서]이면 막대와 이름 왼쪽 띠가 담당부서 색으로 칠해져 부서가 한눈에 구분됩니다. 연관부서는 이름 아래 작은 색 점으로 보여요.\n\n[색: 상태]로 바꾸면 정상·주의·차질 색으로 봅니다.\n[부서별로 묶기]를 켜면 같은 부서 단계끼리 모아서 보여줘요.\n\n간트 아래 부서 범례를 누르면 그 부서 단계만 남습니다.",
      },
      {
        route: "project",
        target: "dept-filter",
        title: "부서 필터",
        body: "특정 부서가 담당하거나 협업하는 단계만 남겨서 볼 수 있어요. 여러 부서를 함께 체크할 수 있고, 간트 아래 부서 범례를 눌러도 선택·해제됩니다. 협업으로 들어간 단계에는 '협업' 표시가 붙어요.\n(프로젝트에 부서가 2개 이상일 때 나타나요)",
      },
      {
        route: "project",
        target: "add-stage",
        role: "editor",
        title: "단계 추가",
        body: "'새 단계'가 맨 아래 생기고 상세 패널이 열립니다. 이름과 일정을 입력하세요. 순서는 패널 위의 ↑↓로 바꿉니다.",
      },
      {
        route: "project",
        target: "more-menu",
        title: "⋯ 더보기",
        body: "· CSV로 내보내기: 엑셀/구글 시트로 다시 열 수 있어요\n· 템플릿으로 저장: 이 단계 구성을 다음 프로젝트에 재사용",
      },
    ],
  },
  {
    id: "stage",
    title: "단계 상세 편집 · 진행 기록",
    desc: "실적 입력, PM 판단, 메모 남기기",
    minutes: 2,
    needsProject: true,
    cleanup: [{ type: "close-stage" }],
    steps: [
      {
        route: "project",
        ready: "proj-tabs",
        event: { type: "open-stage" },
        target: "sp-head",
        title: "단계 상세 패널",
        body: "간트의 단계 이름이나 막대, 진행관리 표의 행을 누르면 오른쪽에 이 패널이 열립니다.",
      },
      {
        route: "project",
        target: "sp-related",
        title: "연관부서 (함께 검토하는 부서)",
        body: "여러 부서가 같이 검토하는 단계라면 담당부서는 하나만 두고, 나머지는 연관부서로 추가하세요. 아래 추천 부서를 누르거나 직접 입력 후 Enter.\n\n단계를 부서마다 따로 만들 필요 없이, 이 단계가 연관부서의 '부서별 일정'에도 자동으로 함께 나타납니다. 일정을 바꾸면 모든 부서 화면에 같이 반영돼요.",
      },
      {
        route: "project",
        target: "sp-plan",
        title: "계획 일정",
        body: "'시작 주차 + 기간(주)'로 입력하면 날짜가 자동 계산되고, 날짜를 직접 고치면 주차가 바뀝니다. 시트처럼 주차로 입력해도, 날짜로 미세 조정해도 돼요.",
      },
      {
        route: "project",
        target: "sp-roles",
        title: "부서별 역할",
        body: "같은 단계라도 부서마다 맡는 일이 다를 때 역할을 지정하세요.\n예) 게임파트: 주관 · 운영팀: 의견 청취 · 경영진: 의결\n\n지정한 역할은 간트·진행관리 표·부서별 일정에 '협업' 대신 표시되고, 부서별 일정에서 역할로 걸러 볼 수 있어요. (예: 우리 부서가 '의결'할 단계만)\n\n담당부서나 연관부서가 하나라도 있을 때 나타납니다.",
      },
      {
        route: "project",
        target: "sp-actual",
        title: "실행 (실적)",
        body: "실제 시작일, 예상 완료일, 실제 완료일, 진행률을 입력합니다.\n끝났으면 [오늘 완료 처리] 버튼 한 번이면 완료일·진행률 100%가 채워져요.",
      },
      {
        route: "project",
        target: "sp-pm",
        title: "PM 관리",
        body: "시트 'PM 프로젝트 진행관리'의 칸들입니다.\n· PM 판단 (자동/정상/주의/차질)\n· 이슈 / 결정 필요사항\n· 다음 액션",
      },
      {
        route: "project",
        target: "sp-check",
        title: "확인 필요 · 미사용",
        body: "· 확인 필요: 체크하면 대시보드의 '지금 챙겨야 할 단계'에 올라갑니다\n· 미사용: 이번 프로젝트에서 안 하는 단계 (예: 공모전형의 '직접 기획'). 진행률·상태 계산에서 빠져요",
      },
      {
        route: "project",
        target: "sp-log",
        title: "진행 기록 (누적 메모)",
        body: "시트에서 '[10/23] 내용'으로 쌓던 메모를 여기에 남깁니다. 작성자와 시간이 자동으로 붙어요.\n\n종류를 메모 / 이슈 / 결정으로 골라두면 나중에 찾기 쉽습니다. 일정이나 PM 판단을 바꾸면 '변경' 기록이 자동으로 남아요.",
      },
      {
        route: "project",
        target: "sp-save",
        role: "editor",
        title: "꼭 [저장]",
        body: "패널에서 고친 내용은 [저장]을 눌러야 반영됩니다. (간트 막대 끌기는 자동 저장)\n진행 기록은 [기록 추가]를 누르는 순간 바로 저장돼요.",
      },
    ],
  },
  {
    id: "pm-table",
    title: "진행관리 표",
    desc: "PM 관점으로 단계를 한 표에서",
    minutes: 1,
    needsProject: true,
    steps: [
      {
        route: "project",
        ready: "proj-tabs",
        event: { type: "tab", tab: "pm" },
        target: "pt-table",
        title: "PM 프로젝트 진행관리",
        body: "시트의 'PM 프로젝트 진행관리' 탭과 같은 표입니다. 최근 진행 기록, 이슈, 다음 액션을 단계별로 한 번에 봐요.\n\n행을 누르면 단계 상세 패널이 열립니다.",
      },
      {
        route: "project",
        target: "pt-quick",
        role: "editor",
        title: "표에서 바로 수정",
        body: "PM 판단과 '확인' 체크는 패널을 열지 않고 표에서 바로 바꿀 수 있어요. 바꾸면 즉시 저장됩니다.",
      },
      {
        route: "project",
        target: "pt-filter",
        title: "필터",
        body: "주간 회의 때는 [주의·차질]이나 [확인 필요]만 띄워놓고 하나씩 보면 편합니다.",
      },
    ],
    cleanup: [{ type: "tab", tab: "gantt" }],
  },
  {
    id: "departments",
    title: "부서별 일정",
    desc: "우리 부서가 담당·협업하는 단계만",
    minutes: 1,
    steps: [
      {
        route: "/departments",
        target: "dept-chips",
        title: "부서 고르기",
        body: "부서를 누를 때마다 선택에 추가·제외되어 여러 부서를 함께 볼 수 있어요. 고른 부서들이 담당하거나 연관부서(협업)로 들어간 단계가 모이고, 여러 부서를 고르면 막대가 부서 색으로 구분됩니다. 숫자는 아직 안 끝난 단계 수예요.\n\n한 번 고른 부서는 다음에 들어와도 기억합니다.",
      },
      {
        route: "/departments",
        target: "dept-projects",
        title: "프로젝트 고르기",
        body: "특정 프로젝트만 보고 싶으면 여기서 고르세요. 여러 개를 함께 고를 수 있고, 아무것도 고르지 않으면 전체가 보입니다.\n\n· 이 부서 단계가 있는 프로젝트가 목록 위쪽에 나와요\n· [프로젝트별]은 프로젝트끼리 묶어서, [날짜순]은 프로젝트를 섞어 시작일 순으로\n· 고른 프로젝트는 기억되고, 주소를 복사해 공유하면 같은 화면이 열립니다",
      },
      {
        route: "/departments",
        target: "dept-roles",
        title: "역할로 거르기",
        body: "고른 부서가 그 단계에서 맡은 역할(주관·의결·검토·협의·의견 청취·공유)로 걸러 볼 수 있어요. 여러 역할을 함께 고를 수 있고, '역할 미지정'은 아직 역할을 정하지 않은 단계입니다.",
      },
      {
        route: "/departments",
        target: "dept-view",
        title: "간트 / 목록",
        body: "· 간트: 여러 프로젝트의 일정을 한 줄로 이어서 보기 (이름 아래 프로젝트명)\n· 목록: 상태·역할(담당/협업)·다음 액션을 표로\n\n단계를 누르면 해당 프로젝트의 단계 상세가 열립니다. 다른 부서와 협의할 때 이 화면을 함께 보면 편해요.",
      },
    ],
  },
  {
    id: "import",
    title: "구글 시트에서 옮겨오기",
    desc: "기존 시트를 복사·붙여넣기로 이전",
    minutes: 2,
    needsProject: true,
    role: "editor",
    cleanup: [{ type: "import", open: false }],
    steps: [
      {
        route: "project",
        target: "import-btn",
        title: "시트에서 가져오기",
        body: "기존 구글 시트 내용을 한 번에 옮기는 기능입니다. 눌러볼게요.",
      },
      {
        route: "project",
        ready: "proj-tabs",
        event: { type: "import", open: true },
        target: "imp-text",
        title: "① 시트에서 복사 → 여기에 붙여넣기",
        body: "구글 시트 'NPD 상세 양식' 탭에서\n'단계' 머리글 행부터 마지막 단계 행까지 드래그로 선택 → Ctrl+C\n여기 클릭 → Ctrl+V\n\n열 이름을 보고 자동으로 맞춰 넣으니 열 순서는 신경 쓰지 않아도 됩니다.",
      },
      {
        route: "project",
        target: "imp-text",
        title: "② PM 진행관리도 같은 방법으로",
        body: "'PM 프로젝트 진행관리' 탭도 머리글부터 복사해 붙여넣으면 PM 판단·이슈·다음 액션·확인 필요·누적 메모가 같은 이름의 단계에 합쳐집니다.\n시트에 '연관부서' 열을 만들어 '구매물류팀, 디자인팀'처럼 적어두면 그것도 같이 들어와요.\n\n(붙여넣으면 아래에 미리보기 표가 나오고, 체크를 풀면 그 줄은 빼고 가져와요. '업무 개괄' 줄은 자동으로 빠집니다.)",
      },
      {
        route: "project",
        target: "imp-mode",
        title: "③ 가져오는 방식",
        body: "· 같은 이름 단계는 업데이트: 대부분 이걸 쓰면 됩니다\n· 모두 새 단계로 추가\n· 기존 단계 모두 지우고 교체: 처음부터 다시 옮길 때만",
      },
      {
        route: "project",
        target: "imp-run",
        title: "④ 가져오기",
        body: "미리보기를 확인하고 누르면 끝! 다 옮긴 뒤 ⋯ 메뉴의 '템플릿으로 저장'을 해두면 다음 프로젝트부터는 붙여넣을 필요가 없어요.",
      },
    ],
  },
  {
    id: "templates",
    title: "템플릿 관리",
    desc: "자주 쓰는 단계 구성 저장",
    minutes: 1,
    steps: [
      {
        route: "/templates",
        target: "tpl-list",
        title: "단계 템플릿",
        body: "새 프로젝트를 만들 때 불러오는 단계 구성입니다. 각 단계의 이름·부서·설명과 '몇 주차부터 몇 주간'이 저장돼 있어요.\n\n프로젝트 시작일만 정하면 날짜는 자동으로 계산됩니다.",
      },
      {
        route: "/templates",
        target: "tpl-add",
        role: "gamepart",
        title: "템플릿 만들기 · 편집",
        body: "여기서 직접 만들 수도 있고, 잘 짜인 프로젝트 화면에서 ⋯ → '템플릿으로 저장'하는 게 더 쉽습니다.\n\n시작주차를 비워두면 앞 단계가 끝난 다음 주로 자동 배치돼요.",
      },
    ],
  },
  {
    id: "access",
    title: "권한 · 팀원 초대",
    desc: "누가 보고, 누가 고칠 수 있는지",
    minutes: 2,
    needsProject: true,
    cleanup: [{ type: "tab", tab: "gantt" }],
    steps: [
      {
        title: "권한 구조",
        body: "· 처음 로그인한 사람 → '승인 대기' (아무것도 못 봄)\n· 승인된 사용자 → 모든 프로젝트 보기\n· 게임파트 → 모든 프로젝트 편집, 프로젝트·템플릿 생성\n· 타부서 → 편집자로 추가된 프로젝트만 편집\n· 관리자 → 사용자 승인·권한 관리",
      },
      {
        route: "project",
        ready: "proj-tabs",
        event: { type: "tab", tab: "settings" },
        target: "ps-members",
        title: "타부서에 편집 권한 주기",
        body: "구매물류팀처럼 특정 단계를 맡은 부서는 이 프로젝트의 [설정·권한] 탭에서 '편집자 추가'를 하면 이 프로젝트만 고칠 수 있어요.\n\n(상대가 먼저 한 번 로그인하고 관리자가 승인해야 목록에 나타납니다.)",
      },
      {
        route: "project",
        target: "ps-info",
        title: "프로젝트 정보 · 시작일 변경",
        body: "시작일을 바꾸면 '모든 단계도 같이 이동'할지 고를 수 있어요. 전체 일정이 밀렸을 때 한 번에 옮길 수 있습니다.",
      },
      {
        route: "project",
        target: "ps-archive",
        role: "gamepart",
        title: "끝난 프로젝트는 보관",
        body: "보관하면 대시보드에서 숨겨지고 기록은 그대로 남습니다. 삭제는 되돌릴 수 없으니 보관을 권해요.",
      },
      {
        route: "/admin",
        target: "admin-table",
        role: "admin",
        title: "사용자 관리 (관리자)",
        body: "팀원에게 사이트 주소를 공유하고, 로그인하면 여기서\n· 승인 체크 → 볼 수 있음\n· 게임파트 체크 → 모든 프로젝트 편집\n· 부서명 입력 (기록·목록에 표시)\n을 해주세요.",
      },
      {
        route: "/admin",
        target: "admin-tabs",
        role: "admin",
        title: "메일 미리 초대 (관리자)",
        body: "[초대] 탭에 팀원 메일을 미리 등록하면, 그 사람은 처음 로그인할 때 승인 대기 없이 바로 들어옵니다.\n\n· 여러 메일을 한 번에 붙여넣기\n· 부서·권한(보기/게임파트/관리자)·편집할 프로젝트를 미리 지정\n· [안내 복사]로 접속 주소와 로그인 방법을 메신저에 붙여넣기\n· 이미 로그인해서 대기 중인 사람도 등록하는 즉시 승인됩니다",
      },
      {
        route: "/admin",
        ready: "admin-tabs",
        target: "admin-tabs",
        role: "admin",
        title: "부서 관리 (관리자)",
        body: "[부서] 탭에서 부서 목록을 관리합니다.\n· 추가 / 순서 변경 / 삭제\n· 부서명 칸을 고치고 [이름 변경] → 그 부서가 들어간 모든 단계·사용자·템플릿에 한 번에 반영\n· 이미 있는 부서명을 입력하면 [합치기] (예: '구매물류' → '구매물류팀')\n· '목록에 없는 부서'에서 시트로 가져온 이름을 정리\n\n단계와 사용자의 부서는 이 목록에서만 고를 수 있어 이름이 섞이지 않아요.",
      },
    ],
  },
];
