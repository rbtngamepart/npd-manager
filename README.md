# 게임파트 NPD 관리 사이트

구글 시트 「게임파트 NPD 양식_상세화」를 웹사이트로 옮긴 버전입니다.
**Next.js + Supabase + Netlify**

## 시트 → 사이트 대응표

| 기존 시트 탭 | 사이트 화면 |
|---|---|
| 전체 프로젝트 조망 | **대시보드** — 프로젝트를 만들면 자동 등록 (탭명 입력 불필요) + "지금 챙겨야 할 단계" 목록 |
| NPD 상세 양식 (1~53주 간트) | **프로젝트 > 일정(간트)** — 막대를 끌어서 이동, 양 끝을 끌어서 기간 조정, 빈 줄을 끌어서 새로 그리기 |
| NPD 월간 보기 | 간트의 **[월]** 버튼 (별도 탭 불필요) |
| PM 프로젝트 진행관리 | **프로젝트 > 진행관리** 표 + 단계를 누르면 열리는 **상세 패널** |
| 진행 메모 `[월/일] 내용` 누적 | **진행 기록** — 작성자·시간 자동, 메모/이슈/결정 구분 |
| 숨김 `NPD-0001` 연결 ID | 필요 없음 (DB가 자동 연결, 정렬해도 안 깨짐) |

### 새로 생긴 편의 기능
- **연관부서**: 단계 하나에 담당부서 + 연관부서(여러 개). 연관부서의 [부서별 일정]에도 자동으로 함께 표시 — 부서마다 단계를 따로 만들 필요 없음
- **사용자 초대 (관리자)**: 사용자 관리 › 초대 탭에 메일을 미리 등록(여러 개 가능) → 그 메일로 첫 로그인 시 승인 없이 바로 접속, 부서·권한·편집 프로젝트 자동 적용. 대기 중인 사람은 등록 즉시 승인. 안내 문구 복사
- **부서 관리 (관리자)**: 사용자 관리 › 부서 탭에서 부서 추가·순서·삭제, 이름 변경 시 모든 단계·사용자·템플릿에 일괄 반영, 같은 부서 합치기. 단계·사용자 부서는 이 목록에서만 선택
- **부서별 역할**: 단계마다 담당·연관부서별 역할(주관·의결·검토·협의·의견 청취·공유) 지정. 간트·표·부서별 일정에 표시, 부서별 일정에서 역할로 필터. 역할 종류는 관리자가 사용자 관리 › 부서·역할 탭에서 관리. 시트 가져오기는 "운영팀(검토)" 형식 지원
- **부서 색 구분**: 부서마다 고정 색(관리자 부서 목록 순서). 간트 막대·이름 띠·라벨에 표시, [색: 부서/상태] 전환, [부서별로 묶기], 범례 클릭으로 필터
- **부서별 일정**: 부서를 고르면 모든 프로젝트에서 그 부서가 담당/협업하는 단계를 간트·목록으로 (프로젝트 여러 개 골라서 보기, 프로젝트별/날짜순 정렬, 주소로 공유)
- **구글 캘린더 연동**: 일정 제목에 `[말머리] 단계명` (세부는 ` - 세부`, 완료는 ✅)을 붙이면 그 프로젝트 단계로 자동 생성·갱신. 설명란 `담당:`/`연관:`으로 부서·역할 지정. 처음 보는 말머리는 [캘린더 연동] › 대기함. 연결 방법 두 가지:
  - **Apps Script** (회사 계정 권장): [내 연결 스크립트 만들기] → 코드를 script.google.com 새 프로젝트에 붙여넣고 `setup` 실행 → 30분마다 [말머리] 일정만 전송
  - **iCal 비공개 주소**: 주소를 붙여넣으면 서버가 매시 정각에 읽음 (회사 관리자가 막아두면 안 보임)
  - Netlify 환경변수 필요: `SUPABASE_SERVICE_ROLE_KEY`(Supabase Secret key `sb_secret_…`), `CRON_SECRET`(아무 긴 문자열). 둘 다 *Contains secret values* 체크
- **지라·컨플루언스 연동용 Netlify 환경변수 (선택)**: `ATLASSIAN_SITE`(xxx.atlassian.net), `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `ATLASSIAN_CONFLUENCE_SPACES`(선택), `ATLASSIAN_WEBHOOK_SECRET`(선택, 없으면 CRON_SECRET), `SLACK_WEBHOOK_URL`(선택, 슬랙 Incoming Webhook — NPD 코드가 적힌 지라 이슈의 상태·댓글·설명, 컨플루언스 문서 생성·수정 시 'NPD 업데이트 요청' 알림). 지라 자동화 규칙 본문·슬랙 알림 규칙 예시는 사이트 [지라 연동] 화면에서 복사
- **단계 상세 패널 넓히기**: [⇤ 펼치기]로 왼쪽 단계 목록만 남기고 확장, 왼쪽 테두리를 끌어 너비 조절(브라우저에 기억). 넓으면 2열·3열 배치
- **그룹(무한 깊이) + 업무 속성 라벨**: 간트 [+ 그룹]으로 단계를 묶고 그룹 안에 그룹을 계속 추가, 접기/펼치기·요약 막대. 라벨(기획·디자인·생산 등)은 여러 개, 게임파트가 목록 관리. 간트·진행관리·기록 탭에서 그룹·라벨로 필터
- **단계 트리 (끌어서 놓기)**: 간트 왼쪽 단계 이름을 끌어 다른 단계 가운데에 놓으면 그 단계의 하위 단계, 위·아래 가장자리에 놓으면 순서 이동. 그룹에도 같은 방식. 하위 단계는 무한 깊이, 접기/펼치기, 상위 단계에 전체 기간 선 표시. 단계 상세에서 [꺼내기]
- **체크리스트**: 단계마다 할 일 체크(여러 줄 붙여넣기, 두 번 눌러 수정), 간트에 ☑2/5 표시
- **파일·링크**: [📁 구글 드라이브]로 내 드라이브·공유 드라이브·공유 문서함에서 파일을 골라 연결(여러 개, 업로드 가능), 또는 주소 붙여넣기. 패널 안에서 [보기]
- **서식 있는 기록**: 진행 기록·주요내용에 글자 크기·굵기·색, 글머리 기호·번호, ☑ 체크박스, 링크. 등록한 기록의 체크박스 바로 체크, 내 기록 수정. 기록 탭에서 종류(메모·이슈·결정·변경·Jira·Confluence)·검색 필터
- **연관 업무(선후 관계)**: 앞 단계를 연결하면 간트에 화살표(겹치면 빨간 점선). 앞 단계 종료·예상 완료가 늦어지면 뒤 단계 목록을 보여주고 [함께 미루기] (간격 유지 / 겹치는 만큼만)
- **단계 코드 + 지라·컨플루언스 수집**: 단계마다 `NPD-XXXXX` 코드와 링크(`/s/코드`). 지라 이슈·댓글, 컨플루언스 문서에 적어두면 기록으로 수집 (지라: 자동화 웹훅 실시간, 컨플루언스·지라 보조: 매시간 API). `결정:` `이슈:`로 시작하는 줄은 결정·이슈 기록. 설정법은 사이트 [지라 연동] 화면
- **크롬 확장 프로그램 'NPD 캘린더 도우미'** (`extension/`): 구글 캘린더 일정 제목 칸 옆 [NPD 단계]·왼쪽 아래 [NPD]·Alt+N → 프로젝트·단계를 골라 제목을 `[말머리] 단계명 - 세부 ✅`로 채우고 설명에 단계 링크. [캘린더 연동] 화면에서 zip 받기·연결 코드 발급. 확장을 고치면 `python3 scripts/zip_extension.py`로 `public/npd-calendar-extension.zip` 다시 만들기
- **튜토리얼**: 상단 [튜토리얼] 버튼 → 9개 단원(화면 둘러보기, 상태 색깔, 새 프로젝트, 간트, 단계 편집, 진행관리, 시트 가져오기, 템플릿, 권한). 실제 화면을 강조하며 단계별 설명, 데이터는 바뀌지 않음. 내용은 `lib/tutorial.ts`에서 수정
- 일정·PM 판단을 바꾸면 **변경 이력이 자동 기록** (예: `계획 09/14~10/04 → 09/14~10/11`)
- 주차+기간 입력 ↔ 날짜 입력 **양방향 자동 계산** (시트와 동일: 1주차 = 시작일, 2주 = 14일)
- 프로젝트 시작일을 바꾸면 **모든 단계를 같이 이동** 할지 선택
- 다른 사람이 수정하면 **화면이 자동 갱신**
- **템플릿**: 공모전형/직접기획형 기본 제공, 어떤 프로젝트든 "템플릿으로 저장" 가능
- **시트에서 가져오기**: 시트를 복사해서 붙여넣으면 단계·일정·PM 기록까지 한 번에 이전
- **CSV 내보내기** (엑셀/시트로 다시 열기)
- 단계별 **미사용** 표시 (예: 공모전형에서 '직접 기획' 단계)

### 상태 판정 규칙
| 자동 상태 | 조건 |
|---|---|
| 완료 | 실제 완료일 입력됨 |
| 🔴 차질 | 계획 종료일이 지났는데 미완료 |
| 🟡 주의 | 예상 완료일 > 계획 종료일 **또는** 계획 시작일이 지났는데 실제 시작일 없음 |
| 대기 | 계획 시작 전 |
| 🟢 정상 | 그 외 |

**최종 상태 = PM 판단이 있으면 PM 판단, 없으면 자동 상태.** 프로젝트 상태는 단계 중 가장 나쁜 상태.
규칙을 바꾸고 싶으면 `lib/status.ts`의 `stageAutoStatus` 함수만 수정하면 됩니다.

### 권한
| 사용자 | 볼 수 있음 | 편집 |
|---|---|---|
| 승인 대기 (처음 로그인) | ✗ | ✗ |
| 승인된 타부서 | 전체 프로젝트 | 편집자로 추가된 프로젝트만 |
| 게임파트 | 전체 | 전체 + 프로젝트 생성/삭제, 템플릿 |
| 관리자 | 전체 | + 사용자 승인·권한 관리 |

**맨 처음 로그인한 사람이 자동으로 관리자 + 게임파트**가 됩니다. (= 민기님이 제일 먼저 로그인하세요)

---

## 설치 순서 (처음 한 번)

### 1. Supabase 프로젝트 만들기
1. https://supabase.com → **New project** (Region: Northeast Asia (Seoul))
2. 왼쪽 메뉴 **SQL Editor** → **New query**
3. `supabase/schema.sql` 파일 내용을 **전부 복사해서 붙여넣고 Run**
   - "Success. No rows returned" 가 나오면 성공
4. 두 값을 메모 (2026년 화면 기준)
   - **Project URL**: `https://<Project ID>.supabase.co`
     (Settings > General의 Project ID, 또는 Integrations > Data API의 API URL에서 `/rest/v1/` 뺀 주소)
   - **공개 키**: Settings > **API Keys** > **Publishable key** (`sb_publishable_...`) 복사 버튼으로 전체 복사
     (또는 같은 화면 `Legacy anon, service_role API keys` 탭의 `anon` 키)
   - ⚠️ **Secret key(`sb_secret_...`)는 절대 사용하지 마세요** — 권한을 우회하는 관리자 키

### 2. 로그인 설정
**Authentication > URL Configuration**
- Site URL: Netlify 주소 (예: `https://rbtn-npd.netlify.app`)
- Redirect URLs 에 추가: `https://rbtn-npd.netlify.app/auth/callback`, `http://localhost:3000/auth/callback`

이메일 로그인 링크는 기본으로 켜져 있습니다.

> **구글 로그인**: Authentication > Sign In / Providers > Google 을 켜고 Client ID/Secret 입력.
> Google Cloud Console의 승인된 리디렉션 URI: `https://<Project ID>.supabase.co/auth/v1/callback` (Netlify 주소 아님)
> → 환경변수 `NEXT_PUBLIC_ENABLE_GOOGLE=true`

### 3. GitHub 저장소
Netlify 무료 플랜은 **조직 소유 비공개 저장소를 빌드하지 못합니다.** 둘 중 하나:
- 저장소를 공개(Public)로 전환 (코드에 키·비밀번호 없음, 데이터는 Supabase 권한으로 보호)
- 개인 계정(`awayminki-ui`)으로 이전해서 비공개 유지

> Vercel은 무료(Hobby)가 비상업 개인용만 허용되고 조직 저장소도 연결 불가라 Netlify를 사용합니다.

### 4. Netlify 배포 (무료)
1. https://app.netlify.com → GitHub로 로그인 → **Add new project > Import an existing project > GitHub**
2. 저장소가 안 보이면 **Configure the Netlify app on GitHub**에서 접근 허용 → `npd-manager` 선택
3. 빌드 설정은 Next.js 자동 인식 그대로 → **Add environment variables**
   | 이름 | 값 |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | 1-4의 Project URL (https://….supabase.co) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 1-4의 Publishable key (sb_publishable_…) |
   | `NEXT_PUBLIC_ENABLE_GOOGLE` | `true` (구글 로그인 안 쓰면 `false`) |
4. **Deploy** → **Project configuration > Change project name**으로 주소 정리 (예: `rbtn-npd`)
5. 그 주소를 2번 URL Configuration에 입력
6. 환경변수를 나중에 바꾸면 **Deploys > Trigger deploy**로 재배포해야 반영됨

### 5. 처음 사용
1. 사이트 접속 → Google 로그인 또는 이메일 링크 (← 민기님이 1등으로! 첫 로그인 = 관리자)
2. **새 프로젝트** → 템플릿 선택 → 시작일 입력
3. 기존 시트 데이터 옮기기: 프로젝트 화면 **[시트에서 가져오기]**
   - 시트 「NPD 상세 양식」에서 `단계` 머리글 행부터 마지막 단계까지 선택 → 복사 → 붙여넣기
   - 「PM 프로젝트 진행관리」도 같은 방법으로 붙여넣으면 PM 판단·이슈·다음 액션·확인필요가 **같은 이름 단계에 합쳐집니다**
4. 단계 구성이 마음에 들면 ⋯ 메뉴 → **이 단계 구성을 템플릿으로 저장** (다음 프로젝트부터 재사용)
5. 팀원 초대: **사용자 관리 › 초대**에 메일 등록 → [안내 복사]로 주소 전달 → 로그인하면 바로 사용
6. 타부서(구매물류팀 등): 승인만 하고, 해당 프로젝트 **설정·권한** 탭에서 편집자로 추가

---

## 업데이트 (이미 설치한 경우)
새 기능이 DB 변경을 필요로 하면 `supabase/` 폴더에 번호 붙은 SQL 파일이 추가됩니다. Supabase **SQL Editor**에 붙여넣고 **Run** 하세요. (여러 번 실행해도 안전)

| 파일 | 내용 |
|---|---|
| `002_related_departments.sql` | 연관부서 칸 추가 |
| `003_departments.sql` | 관리자 부서 관리 (부서 목록, 이름 변경·합치기) |
| `004_invites.sql` | 사용자 초대 (미리 등록한 메일은 로그인 즉시 승인) |
| `005_dept_roles.sql` | 부서별 역할 (주관·의결·검토·협의·의견 청취·공유) |
| `006_calendar.sql` | 구글 캘린더 연동 (말머리 일정 → 단계) |
| `007_calendar_script.sql` | 캘린더 Apps Script 연결 (회사 계정용) |
| `008_stage_tools.sql` | 그룹·업무 속성 라벨·체크리스트·파일 링크·선후 관계·단계 코드·서식 기록·지라/컨플루언스 수집 |
| `009_stage_tree.sql` | 단계 아래 하위 단계 (간트에서 끌어서 놓기) |
| `010_ext_hash.sql` | 지라·컨플루언스 변경 감지 (슬랙 업데이트 요청 알림) |
| `011_ext_tokens.sql` | 크롬 확장 프로그램 'NPD 캘린더 도우미' 연결 코드 |

## 구글 드라이브 선택 창 설정 (관리자 한 번)
구글 로그인용 OAuth 클라이언트를 만든 **같은 구글 클라우드 프로젝트**에서:
1. **API 및 서비스 → 라이브러리**: `Google Picker API`, `Google Drive API` 사용 설정
2. **사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키**
   - 애플리케이션 제한: *웹사이트* → `https://rbtngamepartnpd.netlify.app/*`
   - API 제한: *Google Picker API*, *Google Drive API*
3. **사용자 인증 정보 → OAuth 2.0 클라이언트(웹 애플리케이션)** 열기 → *승인된 JavaScript 원본*에 `https://rbtngamepartnpd.netlify.app` 추가 → 클라이언트 ID 복사
4. **OAuth 동의 화면 → 데이터 액세스 → 범위 추가**: `.../auth/drive.file` (고른 파일만 접근, 구글 심사 불필요)
5. 대시보드에서 **프로젝트 번호**(숫자) 확인
6. Netlify 환경변수 3개 추가 → 다시 배포. **화면용 값이라 Contains secret values 는 체크하지 않음** (체크하면 배포가 실패함)

| Key | Value |
|---|---|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | 3번 클라이언트 ID (`…apps.googleusercontent.com`) |
| `NEXT_PUBLIC_GOOGLE_API_KEY` | 2번 API 키 |
| `NEXT_PUBLIC_GOOGLE_APP_ID` | 5번 프로젝트 번호 |

## 내 컴퓨터에서 실행 (개발용)
```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:3000
```

## 폴더 구조
```
supabase/schema.sql        DB 테이블·권한·기본 템플릿 (Supabase에 1회 실행)
app/(main)/page.tsx        대시보드 (전체 프로젝트 조망)
app/(main)/projects/[id]   프로젝트 상세 (간트·진행관리·기록·설정)
app/(main)/templates       템플릿 관리
app/(main)/admin           사용자 승인·권한
components/Gantt.tsx       드래그 가능한 간트 차트
components/StagePanel.tsx  단계 상세 편집 패널
components/ImportDialog.tsx 구글 시트 붙여넣기 가져오기
lib/status.ts              자동 상태 판정 규칙
lib/dates.ts               주차 ↔ 날짜 계산
```
