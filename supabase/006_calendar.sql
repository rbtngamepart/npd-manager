-- =====================================================================
-- 업데이트 006: 구글 캘린더 연동 (말머리 [프로젝트] 일정을 단계로 자동 반영)
-- 005까지 실행한 뒤, 이 파일 내용만 새 쿼리 탭에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- =====================================================================

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
