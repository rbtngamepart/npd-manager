-- =====================================================================
-- 게임파트 NPD 관리 사이트 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- (처음 한 번만 실행. 다시 실행해도 안전하도록 작성되어 있습니다.)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. 사용자 프로필
--    approved      : 관리자가 승인해야 사이트를 볼 수 있음
--    is_game_part  : 게임파트 = 모든 프로젝트 편집 가능
--    is_admin      : 사용자 승인/권한 관리
--    ※ 가장 먼저 가입한 사람이 자동으로 관리자 + 게임파트가 됩니다.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text not null,
  name         text,
  department   text,
  approved     boolean not null default false,
  is_game_part boolean not null default false,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, email, name, department, approved, is_game_part, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when first_user then '게임파트' else null end,
    first_user, first_user, first_user
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 권한 확인용 함수 -------------------------------------------------------
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_game_part()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_game_part from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_admin from public.profiles where id = auth.uid()), false)
$$;

-- 관리자가 아닌 사람은 자기 권한 칸(approved/is_game_part/is_admin)을 바꿀 수 없게
create or replace function public.protect_profile_flags()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.approved     := old.approved;
    new.is_game_part := old.is_game_part;
    new.is_admin     := old.is_admin;
    new.email        := old.email;
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_flags on public.profiles;
create trigger profiles_protect_flags
  before update on public.profiles
  for each row execute function public.protect_profile_flags();

-- ---------------------------------------------------------------------
-- 2. 프로젝트  (시트의 '전체 프로젝트 조망' 한 줄 = 프로젝트 하나)
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text,                       -- 유형 (오리지널게임, 콜라보 등)
  description text,
  start_date  date,                       -- 프로젝트 1주차 시작일
  pm_id       uuid references public.profiles(id) on delete set null,
  pm_status   text check (pm_status in ('green','yellow','red')),
  pm_memo     text,
  archived    boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 프로젝트별 추가 편집자 (타부서에 프로젝트 단위로 편집 권한 부여)
create table if not exists public.project_members (
  project_id uuid not null references public.projects on delete cascade,
  user_id    uuid not null references public.profiles on delete cascade,
  role       text not null default 'editor' check (role in ('editor')),
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);

create or replace function public.can_edit_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_game_part()
      or (public.is_approved() and exists (
            select 1 from public.project_members m
            where m.project_id = pid and m.user_id = auth.uid()))
$$;

-- ---------------------------------------------------------------------
-- 3. 단계  (시트의 'NPD 상세 양식' + 'PM 프로젝트 진행관리' 한 줄)
--    날짜가 원본이고, 주차는 화면에서 프로젝트 시작일 기준으로 자동 계산
-- ---------------------------------------------------------------------
create table if not exists public.stages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects on delete cascade,
  sort_order   int  not null default 0,
  name         text not null,
  department   text,
  description  text,
  plan_start   date,
  plan_end     date,
  actual_start date,
  expected_end date,
  actual_end   date,
  progress     int  not null default 0 check (progress between 0 and 100),
  pm_status    text check (pm_status in ('green','yellow','red')),
  issue        text,          -- 이슈 / 결정 필요사항
  next_action  text,          -- 다음 액션
  assignee     text,          -- 담당 / 협의 대상
  needs_check  boolean not null default false,  -- 확인 필요
  skipped      boolean not null default false,  -- 이번 프로젝트에서 미사용 단계
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null default auth.uid()
);
create index if not exists stages_project_idx on public.stages(project_id, sort_order);

-- ---------------------------------------------------------------------
-- 4. 진행 기록 (누적 메모)  — 단계가 삭제돼도 기록은 남김
-- ---------------------------------------------------------------------
create table if not exists public.stage_logs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects on delete cascade,
  stage_id    uuid references public.stages on delete set null,
  stage_name  text,
  kind        text not null default 'memo' check (kind in ('memo','issue','decision','change')),
  body        text not null,
  author_id   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists stage_logs_stage_idx on public.stage_logs(stage_id, created_at desc);
create index if not exists stage_logs_project_idx on public.stage_logs(project_id, created_at desc);

-- 일정이 바뀌면 자동으로 '변경' 기록을 남김
create or replace function public.log_stage_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  msgs text[] := '{}';
  f text := 'MM/DD';
begin
  if new.plan_start is distinct from old.plan_start or new.plan_end is distinct from old.plan_end then
    msgs := msgs || format('계획 %s~%s → %s~%s',
      coalesce(to_char(old.plan_start, f), '-'), coalesce(to_char(old.plan_end, f), '-'),
      coalesce(to_char(new.plan_start, f), '-'), coalesce(to_char(new.plan_end, f), '-'));
  end if;
  if new.expected_end is distinct from old.expected_end then
    msgs := msgs || format('예상 완료 %s → %s',
      coalesce(to_char(old.expected_end, f), '-'), coalesce(to_char(new.expected_end, f), '-'));
  end if;
  if new.actual_start is distinct from old.actual_start and new.actual_start is not null then
    msgs := msgs || format('실제 시작 %s', to_char(new.actual_start, f));
  end if;
  if new.actual_end is distinct from old.actual_end and new.actual_end is not null then
    msgs := msgs || format('완료 처리 %s', to_char(new.actual_end, f));
  end if;
  if new.pm_status is distinct from old.pm_status then
    msgs := msgs || format('PM 판단 %s → %s',
      coalesce(old.pm_status, '없음'), coalesce(new.pm_status, '없음'));
  end if;
  if array_length(msgs, 1) > 0 then
    insert into public.stage_logs (project_id, stage_id, stage_name, kind, body, author_id)
    values (new.project_id, new.id, new.name, 'change', array_to_string(msgs, ' · '), auth.uid());
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists stages_log_changes on public.stages;
create trigger stages_log_changes
  before update on public.stages
  for each row execute function public.log_stage_changes();

create or replace function public.touch_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.projects set updated_at = now()
  where id = coalesce(new.project_id, old.project_id);
  return null;
end $$;

drop trigger if exists stages_touch_project on public.stages;
create trigger stages_touch_project
  after insert or update or delete on public.stages
  for each row execute function public.touch_project();

-- ---------------------------------------------------------------------
-- 5. 단계 템플릿
--    stages: [{"name","department","description","start_week","weeks","skipped"}]
-- ---------------------------------------------------------------------
create table if not exists public.templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  stages      jsonb not null default '[]'::jsonb,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. 접근 권한 (Row Level Security)
--    - 승인된 사용자: 전체 열람
--    - 게임파트: 모든 프로젝트 생성/편집
--    - 타부서: 멤버로 추가된 프로젝트만 편집
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.stages          enable row level security;
alter table public.stage_logs      enable row level security;
alter table public.templates       enable row level security;

drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select using (id = auth.uid() or public.is_approved());
create policy "profiles update" on public.profiles for update using (id = auth.uid() or public.is_admin());

drop policy if exists "projects read"   on public.projects;
drop policy if exists "projects insert" on public.projects;
drop policy if exists "projects update" on public.projects;
drop policy if exists "projects delete" on public.projects;
create policy "projects read"   on public.projects for select using (public.is_approved());
create policy "projects insert" on public.projects for insert with check (public.is_game_part());
create policy "projects update" on public.projects for update using (public.can_edit_project(id));
create policy "projects delete" on public.projects for delete using (public.is_game_part());

drop policy if exists "members read"  on public.project_members;
drop policy if exists "members write" on public.project_members;
create policy "members read"  on public.project_members for select using (public.is_approved());
create policy "members write" on public.project_members for all
  using (public.is_game_part()) with check (public.is_game_part());

drop policy if exists "stages read"  on public.stages;
drop policy if exists "stages write" on public.stages;
create policy "stages read"  on public.stages for select using (public.is_approved());
create policy "stages write" on public.stages for all
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

drop policy if exists "logs read"   on public.stage_logs;
drop policy if exists "logs insert" on public.stage_logs;
drop policy if exists "logs delete" on public.stage_logs;
create policy "logs read"   on public.stage_logs for select using (public.is_approved());
create policy "logs insert" on public.stage_logs for insert
  with check (public.can_edit_project(project_id) and author_id = auth.uid());
create policy "logs delete" on public.stage_logs for delete
  using (author_id = auth.uid() and kind <> 'change');

drop policy if exists "templates read"  on public.templates;
drop policy if exists "templates write" on public.templates;
create policy "templates read"  on public.templates for select using (public.is_approved());
create policy "templates write" on public.templates for all
  using (public.is_game_part()) with check (public.is_game_part());

-- ---------------------------------------------------------------------
-- 7. 기본 템플릿 (기존 'NPD 상세 양식' 기준)
--    ※ 시트에서 확인된 단계만 넣었습니다. 나머지 단계(매장 테스트, 출시 후 관리 등)는
--      프로젝트 화면의 [시트에서 가져오기]로 붙여넣은 뒤 [템플릿으로 저장] 하세요.
-- ---------------------------------------------------------------------
insert into public.templates (name, description, stages)
select '오리지널게임 개발 (공모전형)', 'NPD 상세 양식 기준 · 공모전 기반 기획', '[
  {"name":"공모전 기획(공모전형)","department":"게임파트","description":"공모전 기획 확정, 모집 요강·제출 기준 정리 및 홍보 준비","start_week":1,"weeks":2},
  {"name":"공모전 진행(제안 접수)","department":"게임파트","description":"외부 제안 접수 및 문의 대응, 접수 현황 관리","start_week":3,"weeks":4},
  {"name":"공모전 종료(평가·검수·발표)","department":"게임파트","description":"접수작 평가, 규칙·구성 검수, 최종 선정 및 합격자 발표","start_week":7,"weeks":3},
  {"name":"공모전 종료 결과 다듬기","department":"게임파트","description":"선정작의 규칙·구성·핵심 재미를 정리하고 내부 개발 가능한 형태로 보완","start_week":10,"weeks":1},
  {"name":"게임 개발","department":"게임파트","description":"프로토타입 제작, 내부 테스트, 룰 수정, 밸런스 조정 및 최종 규칙 확정","start_week":11,"weeks":8},
  {"name":"제품화 검증","department":"게임파트","description":"구성품 사양, 샘플, 규칙·제품 표기 및 실제 생산 가능성을 검증하고, 구매물류팀과 협의할 소재·생산 방식·요구 스펙의 기준을 정리","start_week":19,"weeks":4},
  {"name":"베타 타입 제작(고객 플레이 용)","department":"게임파트","description":"고객 및 매장 테스트 플레이에 사용할 베타타입 제작","start_week":21,"weeks":2}
]'::jsonb
where not exists (select 1 from public.templates where name = '오리지널게임 개발 (공모전형)');

insert into public.templates (name, description, stages)
select '오리지널게임 개발 (직접기획형)', 'NPD 상세 양식 기준 · 직접 기획', '[
  {"name":"직접 기획(직접기획형)","department":"게임파트","description":"직접 기획형 프로젝트 선택 시 진행 (기간은 프로젝트에 맞게 입력)","start_week":1,"weeks":null},
  {"name":"게임 개발","department":"게임파트","description":"프로토타입 제작, 내부 테스트, 룰 수정, 밸런스 조정 및 최종 규칙 확정","start_week":null,"weeks":8},
  {"name":"제품화 검증","department":"게임파트","description":"구성품 사양, 샘플, 규칙·제품 표기 및 실제 생산 가능성을 검증하고, 구매물류팀과 협의할 소재·생산 방식·요구 스펙의 기준을 정리","start_week":null,"weeks":4},
  {"name":"베타 타입 제작(고객 플레이 용)","department":"게임파트","description":"고객 및 매장 테스트 플레이에 사용할 베타타입 제작","start_week":null,"weeks":2}
]'::jsonb
where not exists (select 1 from public.templates where name = '오리지널게임 개발 (직접기획형)');

-- ---------------------------------------------------------------------
-- 8. 실시간 반영 (다른 사람이 수정하면 화면이 자동 갱신)
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.stages;     exception when others then null; end;
  begin alter publication supabase_realtime add table public.stage_logs; exception when others then null; end;
  begin alter publication supabase_realtime add table public.projects;   exception when others then null; end;
end $$;
