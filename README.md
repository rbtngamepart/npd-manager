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
- **부서별 일정**: 부서를 고르면 모든 프로젝트에서 그 부서가 담당/협업하는 단계를 간트·목록으로
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
5. 팀원 초대: 사이트 주소 공유 → 로그인하면 **사용자 관리**에서 승인 + 게임파트 체크
6. 타부서(구매물류팀 등): 승인만 하고, 해당 프로젝트 **설정·권한** 탭에서 편집자로 추가

---

## 업데이트 (이미 설치한 경우)
새 기능이 DB 변경을 필요로 하면 `supabase/` 폴더에 번호 붙은 SQL 파일이 추가됩니다. Supabase **SQL Editor**에 붙여넣고 **Run** 하세요. (여러 번 실행해도 안전)

| 파일 | 내용 |
|---|---|
| `002_related_departments.sql` | 연관부서 칸 추가 |

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
