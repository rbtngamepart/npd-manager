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
  related_departments text[] not null default '{}',  -- 연관부서 (함께 검토·협업)
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
-- (이미 만든 DB에 연관부서 칸 추가)
alter table public.stages add column if not exists related_departments text[] not null default '{}';
create index if not exists stages_related_idx on public.stages using gin(related_departments);
-- (부서별 역할: {"게임파트":"주관","운영팀":"의견 청취"})
alter table public.stages add column if not exists dept_roles jsonb not null default '{}'::jsonb;

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
  -- 관리자 부서명 일괄 변경 중에는 기록 생략
  if coalesce(current_setting('npd.skip_log', true), '') = 'on' then
    new.updated_at := now();
    return new;
  end if;
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
  if new.department is distinct from old.department then
    msgs := msgs || format('담당부서 %s → %s', coalesce(old.department, '-'), coalesce(new.department, '-'));
  end if;
  if new.related_departments is distinct from old.related_departments then
    msgs := msgs || format('연관부서 %s',
      coalesce(nullif(array_to_string(new.related_departments, ', '), ''), '없음'));
  end if;
  if new.dept_roles is distinct from old.dept_roles then
    msgs := msgs || format('역할 %s', coalesce(
      (select string_agg(k || ' ' || (v #>> '{}'), ', ' order by k) from jsonb_each(new.dept_roles) as x(k, v)), '없음'));
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
-- 부서 목록 (관리자가 사이트의 [사용자 관리 > 부서] 탭에서 관리)
-- ---------------------------------------------------------------------
create table if not exists public.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

alter table public.departments enable row level security;
drop policy if exists "departments read"  on public.departments;
drop policy if exists "departments write" on public.departments;
create policy "departments read"  on public.departments for select using (public.is_approved());
create policy "departments write" on public.departments for all
  using (public.is_admin()) with check (public.is_admin());

-- 지금까지 쓰인 부서명을 목록으로 옮겨 담기 (처음 한 번)
insert into public.departments (name, sort_order)
select name, (row_number() over (order by case when name = '게임파트' then 0 else 1 end, name))::int - 1
from (
  select '게임파트' as name
  union select '구매물류팀'
  union select btrim(department) from public.stages where coalesce(btrim(department), '') <> ''
  union select btrim(unnest(related_departments)) from public.stages
  union select btrim(department) from public.profiles where coalesce(btrim(department), '') <> ''
) x
where coalesce(name, '') <> ''
on conflict (name) do nothing;

-- 부서명 변경 / 합치기: 단계(담당·연관), 사용자, 템플릿에 한 번에 반영
create or replace function public.rename_department(old_name text, new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  n text := btrim(coalesce(new_name, ''));
begin
  if not public.is_admin() then
    raise exception '관리자만 부서명을 바꿀 수 있습니다';
  end if;
  if n = '' then
    raise exception '새 부서명을 입력하세요';
  end if;
  if old_name = n then
    return;
  end if;

  perform set_config('npd.skip_log', 'on', true);

  if exists (select 1 from public.departments where name = n) then
    delete from public.departments where name = old_name;          -- 합치기
  else
    update public.departments set name = n where name = old_name;  -- 이름 변경
    if not found then
      insert into public.departments (name, sort_order)
      values (n, coalesce((select max(sort_order) + 1 from public.departments), 0));
    end if;
  end if;

  update public.stages set department = n where department = old_name;
  update public.stages
     set related_departments = array_remove(
           array(select distinct x from unnest(array_replace(related_departments, old_name, n)) as x),
           department)
   where old_name = any(related_departments);
  update public.stages
     set related_departments = array_remove(related_departments, department)
   where department = n and n = any(related_departments);
  update public.profiles set department = n where department = old_name;

  update public.templates t
     set stages = coalesce((
       select jsonb_agg(
                (case when e->>'department' = old_name then jsonb_set(e, '{department}', to_jsonb(n)) else e end)
                || case when jsonb_typeof(e->'related_departments') = 'array' then
                     jsonb_build_object('related_departments', (
                       select coalesce(jsonb_agg(distinct case when r = old_name then n else r end), '[]'::jsonb)
                       from jsonb_array_elements_text(e->'related_departments') as r
                       where (case when r = old_name then n else r end)
                             is distinct from (case when e->>'department' = old_name then n else e->>'department' end)))
                   else '{}'::jsonb end
                order by ord)
       from jsonb_array_elements(t.stages) with ordinality as x(e, ord)
     ), '[]'::jsonb)
   where t.stages::text like '%' || old_name || '%';

  -- 부서별 역할의 부서 이름도 변경 (합치는 경우 기존 역할 유지)
  update public.stages
     set dept_roles = jsonb_build_object(n, dept_roles->old_name) || (dept_roles - old_name)
   where dept_roles ? old_name;
  update public.templates t
     set stages = coalesce((
       select jsonb_agg(
                case when jsonb_typeof(e->'dept_roles') = 'object' and (e->'dept_roles') ? old_name
                     then jsonb_set(e, '{dept_roles}', jsonb_build_object(n, e->'dept_roles'->old_name) || ((e->'dept_roles') - old_name))
                     else e end
                order by ord)
       from jsonb_array_elements(t.stages) with ordinality as x(e, ord)
     ), '[]'::jsonb)
   where t.stages::text like '%' || old_name || '%';

  perform set_config('npd.skip_log', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- 초대 (관리자가 미리 등록한 메일은 첫 로그인 때 바로 승인)
-- ---------------------------------------------------------------------
create table if not exists public.invites (
  email        text primary key,                 -- 소문자로 저장
  name         text,
  department   text,
  is_game_part boolean not null default false,
  is_admin     boolean not null default false,
  project_ids  uuid[]  not null default '{}',    -- 편집자로 추가할 프로젝트
  invited_by   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  used_at      timestamptz,                      -- 실제로 로그인(가입)한 시각
  user_id      uuid references public.profiles(id) on delete set null
);

alter table public.invites enable row level security;
drop policy if exists "invites admin" on public.invites;
create policy "invites admin" on public.invites for all
  using (public.is_admin()) with check (public.is_admin());

-- 이메일은 항상 소문자·공백 제거
create or replace function public.normalize_invite()
returns trigger language plpgsql as $$
begin
  new.email := lower(btrim(new.email));
  return new;
end $$;

drop trigger if exists invites_normalize on public.invites;
create trigger invites_normalize
  before insert or update on public.invites
  for each row execute function public.normalize_invite();

-- 첫 로그인(가입) 때: 초대가 있으면 바로 승인 + 부서·권한·프로젝트 적용
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
  inv public.invites%rowtype;
begin
  select not exists (select 1 from public.profiles) into first_user;
  select * into inv from public.invites where email = lower(btrim(new.email));

  insert into public.profiles (id, email, name, department, approved, is_game_part, is_admin)
  values (
    new.id,
    new.email,
    coalesce(nullif(btrim(inv.name), ''), new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when first_user then coalesce(inv.department, '게임파트') else inv.department end,
    first_user or inv.email is not null,
    first_user or coalesce(inv.is_game_part, false),
    first_user or coalesce(inv.is_admin, false)
  )
  on conflict (id) do nothing;

  if inv.email is not null then
    insert into public.project_members (project_id, user_id)
    select p.id, new.id from public.projects p where p.id = any(inv.project_ids)
    on conflict do nothing;
    update public.invites set used_at = now(), user_id = new.id where email = inv.email;
  end if;
  return new;
end $$;

-- 이미 로그인해서 '승인 대기' 중인 사람을 초대하면 즉시 적용
create or replace function public.apply_invite_to_existing()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
begin
  select id into pid from public.profiles where lower(email) = new.email;
  if pid is null then
    return new;
  end if;
  update public.profiles
     set approved     = true,
         department   = coalesce(new.department, department),
         name         = coalesce(nullif(btrim(new.name), ''), name),
         is_game_part = is_game_part or new.is_game_part,
         is_admin     = is_admin or new.is_admin
   where id = pid;
  insert into public.project_members (project_id, user_id)
  select p.id, pid from public.projects p where p.id = any(new.project_ids)
  on conflict do nothing;
  update public.invites set used_at = coalesce(used_at, now()), user_id = pid
   where email = new.email and (user_id is distinct from pid or used_at is null);
  return new;
end $$;

drop trigger if exists invites_apply_existing on public.invites;
create trigger invites_apply_existing
  after insert or update of department, name, is_game_part, is_admin, project_ids on public.invites
  for each row execute function public.apply_invite_to_existing();

-- ---------------------------------------------------------------------
-- 역할 종류 (단계에서 부서마다 맡는 역할: 주관, 의결, 검토, 협의 …)
-- ---------------------------------------------------------------------
create table if not exists public.role_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.role_types enable row level security;
drop policy if exists "role_types read"  on public.role_types;
drop policy if exists "role_types write" on public.role_types;
create policy "role_types read"  on public.role_types for select using (public.is_approved());
create policy "role_types write" on public.role_types for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.role_types (name, description, sort_order) values
  ('주관',     '실제로 업무를 수행하고 결과를 책임짐', 0),
  ('의결',     '최종 결정·승인',                       1),
  ('검토',     '결과물을 확인하고 의견·수정 요청',     2),
  ('협의',     '함께 논의해 방향을 정함',              3),
  ('의견 청취', '의견을 듣고, 반영 여부는 주관 부서가 판단', 4),
  ('공유',     '진행 상황만 공유받음',                  5)
on conflict (name) do nothing;

-- 역할 이름 변경 / 합치기: 모든 단계·템플릿에 반영
create or replace function public.rename_role_type(old_name text, new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  n text := btrim(coalesce(new_name, ''));
begin
  if not public.is_admin() then
    raise exception '관리자만 역할 이름을 바꿀 수 있습니다';
  end if;
  if n = '' then
    raise exception '새 역할 이름을 입력하세요';
  end if;
  if old_name = n then
    return;
  end if;

  perform set_config('npd.skip_log', 'on', true);

  if exists (select 1 from public.role_types where name = n) then
    delete from public.role_types where name = old_name;
  else
    update public.role_types set name = n where name = old_name;
  end if;

  update public.stages s
     set dept_roles = (
       select coalesce(jsonb_object_agg(k, case when v #>> '{}' = old_name then to_jsonb(n) else v end), '{}'::jsonb)
       from jsonb_each(s.dept_roles) as x(k, v))
   where exists (select 1 from jsonb_each_text(s.dept_roles) as y(k, v) where v = old_name);

  update public.templates t
     set stages = coalesce((
       select jsonb_agg(
                case when jsonb_typeof(e->'dept_roles') = 'object' then
                  jsonb_set(e, '{dept_roles}', (
                    select coalesce(jsonb_object_agg(k, case when v #>> '{}' = old_name then to_jsonb(n) else v end), '{}'::jsonb)
                    from jsonb_each(e->'dept_roles') as x(k, v)))
                else e end
                order by ord)
       from jsonb_array_elements(t.stages) with ordinality as x(e, ord)
     ), '[]'::jsonb)
   where t.stages::text like '%' || old_name || '%';

  perform set_config('npd.skip_log', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- 구글 캘린더 연동
-- ---------------------------------------------------------------------
-- 프로젝트의 캘린더 말머리 (예: {OG26, 오리지널게임})
alter table public.projects add column if not exists calendar_tags text[] not null default '{}';

-- 단계의 캘린더 연동 상태
alter table public.stages add column if not exists cal_linked  boolean not null default false; -- 캘린더 일정과 연결됨
alter table public.stages add column if not exists cal_follow  boolean not null default true;  -- 계획일을 캘린더가 정함
alter table public.stages add column if not exists cal_missing boolean not null default false; -- 연결된 일정이 캘린더에서 모두 사라짐

-- ---------------------------------------------------------------------
-- 개인별 캘린더 (iCal 비공개 주소) — 주소는 본인만 볼 수 있음
-- ---------------------------------------------------------------------
create table if not exists public.calendar_sources (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  label          text,
  ics_url        text not null check (ics_url like 'https://calendar.google.com/calendar/ical/%'),
  enabled        boolean not null default true,
  last_synced_at timestamptz,
  last_error     text,
  event_count    int not null default 0,   -- 말머리가 붙은 일정 수
  created_at     timestamptz not null default now()
);

alter table public.calendar_sources enable row level security;
drop policy if exists "cal sources own"          on public.calendar_sources;
drop policy if exists "cal sources admin delete" on public.calendar_sources;
create policy "cal sources own" on public.calendar_sources for all
  using (owner_id = auth.uid() and public.is_approved())
  with check (owner_id = auth.uid() and public.is_approved());
create policy "cal sources admin delete" on public.calendar_sources for delete using (public.is_admin());

-- 연결 현황 (주소는 빼고) — 모든 승인 사용자가 볼 수 있음
create or replace function public.calendar_sources_overview()
returns table (id uuid, owner_id uuid, label text, enabled boolean, last_synced_at timestamptz, last_error text, event_count int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, owner_id, label, enabled, last_synced_at, last_error, event_count, created_at
  from public.calendar_sources
  where public.is_approved()
  order by created_at
$$;

-- ---------------------------------------------------------------------
-- 말머리가 붙은 일정만 저장 (개인 일정은 저장하지 않음). 서버 동기화가 기록.
-- ---------------------------------------------------------------------
create table if not exists public.calendar_events (
  key           text primary key,          -- 구글 일정 UID + 반복 회차
  uid           text not null,
  source_ids    uuid[] not null default '{}',
  tag           text not null,             -- 말머리 원문
  tag_norm      text not null,             -- 비교용 (소문자, 공백 제거)
  project_id    uuid references public.projects on delete set null,
  stage_id      uuid references public.stages on delete set null,
  stage_name    text not null,
  detail        text,                      -- '단계명 - 세부' 의 세부
  title         text not null,
  start_date    date not null,
  end_date      date not null,
  start_at      timestamptz,               -- 시간 일정이면 시작 시각
  all_day       boolean not null default false,
  done          boolean not null default false,
  organizer     text,
  attendees     text[] not null default '{}',
  desc_owner    text,                      -- 설명란 '담당:'
  desc_related  text[] not null default '{}',
  desc_roles    jsonb not null default '{}'::jsonb,
  removed       boolean not null default false,
  last_seen_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists calendar_events_project_idx on public.calendar_events(project_id, stage_name);
create index if not exists calendar_events_tag_idx on public.calendar_events(tag_norm);
create index if not exists calendar_events_stage_idx on public.calendar_events(stage_id);

alter table public.calendar_events enable row level security;
drop policy if exists "cal events read" on public.calendar_events;
create policy "cal events read" on public.calendar_events for select using (public.is_approved());

-- 무시할 말머리 (대기함에서 '무시')
create table if not exists public.calendar_ignored_tags (
  tag_norm   text primary key,
  tag        text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.calendar_ignored_tags enable row level security;
drop policy if exists "cal ignored read"  on public.calendar_ignored_tags;
drop policy if exists "cal ignored write" on public.calendar_ignored_tags;
create policy "cal ignored read"  on public.calendar_ignored_tags for select using (public.is_approved());
create policy "cal ignored write" on public.calendar_ignored_tags for all
  using (public.is_game_part()) with check (public.is_game_part());

-- 마지막 동기화 결과 (한 줄)
create table if not exists public.calendar_sync_state (
  id          int primary key default 1 check (id = 1),
  last_run_at timestamptz,
  last_result jsonb not null default '{}'::jsonb
);
insert into public.calendar_sync_state (id) values (1) on conflict do nothing;
alter table public.calendar_sync_state enable row level security;
drop policy if exists "cal state read" on public.calendar_sync_state;
create policy "cal state read" on public.calendar_sync_state for select using (public.is_approved());

-- 화면 자동 갱신
do $$
begin
  begin alter publication supabase_realtime add table public.calendar_events; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- 8. 실시간 반영 (다른 사람이 수정하면 화면이 자동 갱신)
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.stages;     exception when others then null; end;
  begin alter publication supabase_realtime add table public.stage_logs; exception when others then null; end;
  begin alter publication supabase_realtime add table public.projects;   exception when others then null; end;
end $$;
