-- =====================================================================
-- 업데이트 008: 그룹(무한 깊이)·업무 속성 라벨·체크리스트·파일 링크·선후 관계·
--               단계 참조 코드·서식 있는 기록·지라/컨플루언스 수집
-- 007까지 실행한 뒤, 이 파일 내용만 새 쿼리 탭에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 그룹: 단계를 묶는 상위 분류. 그룹 안에 그룹을 계속 넣을 수 있음
--    같은 부모 안에서는 그룹과 단계가 sort_order 하나로 섞여서 정렬됨
-- ---------------------------------------------------------------------
create table if not exists public.stage_groups (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  parent_id  uuid references public.stage_groups on delete set null,
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists stage_groups_project_idx on public.stage_groups(project_id, parent_id, sort_order);
alter table public.stages add column if not exists group_id uuid references public.stage_groups on delete set null;

alter table public.stage_groups enable row level security;
drop policy if exists "groups read"  on public.stage_groups;
drop policy if exists "groups write" on public.stage_groups;
create policy "groups read"  on public.stage_groups for select using (public.is_approved());
create policy "groups write" on public.stage_groups for all
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

-- ---------------------------------------------------------------------
-- 2. 업무 속성 라벨 (전체 공용 목록, 게임파트가 관리). 단계마다 여러 개
-- ---------------------------------------------------------------------
create table if not exists public.stage_labels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  color      text,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.stages add column if not exists label_ids uuid[] not null default '{}';
create index if not exists stages_labels_idx on public.stages using gin(label_ids);

alter table public.stage_labels enable row level security;
drop policy if exists "labels read"  on public.stage_labels;
drop policy if exists "labels write" on public.stage_labels;
create policy "labels read"  on public.stage_labels for select using (public.is_approved());
create policy "labels write" on public.stage_labels for all
  using (public.is_game_part()) with check (public.is_game_part());

-- 라벨을 지우면 단계에서도 빼기 (변경 기록은 남기지 않음)
create or replace function public.stage_label_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('npd.skip_log', 'on', true);
  update public.stages set label_ids = array_remove(label_ids, old.id) where old.id = any(label_ids);
  perform set_config('npd.skip_log', '', true);
  return old;
end $$;
drop trigger if exists stage_labels_cleanup on public.stage_labels;
create trigger stage_labels_cleanup after delete on public.stage_labels
  for each row execute function public.stage_label_deleted();

insert into public.stage_labels (name, color, sort_order)
select v.name, v.color, v.ord from (values
  ('기획', '#6366f1', 1), ('디자인', '#ec4899', 2), ('개발', '#0ea5e9', 3),
  ('생산', '#f59e0b', 4), ('계약·법무', '#64748b', 5), ('마케팅', '#10b981', 6)
) as v(name, color, ord)
where not exists (select 1 from public.stage_labels);

-- ---------------------------------------------------------------------
-- 3. 단계별 체크리스트
-- ---------------------------------------------------------------------
create table if not exists public.stage_checks (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  stage_id   uuid not null references public.stages on delete cascade,
  body       text not null,
  done       boolean not null default false,
  sort_order int  not null default 0,
  done_by    uuid references public.profiles(id) on delete set null,
  done_at    timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists stage_checks_stage_idx on public.stage_checks(stage_id, sort_order);
create index if not exists stage_checks_project_idx on public.stage_checks(project_id);

alter table public.stage_checks enable row level security;
drop policy if exists "checks read"  on public.stage_checks;
drop policy if exists "checks write" on public.stage_checks;
create policy "checks read"  on public.stage_checks for select using (public.is_approved());
create policy "checks write" on public.stage_checks for all
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

-- ---------------------------------------------------------------------
-- 4. 파일·링크 (구글 드라이브 등)
-- ---------------------------------------------------------------------
create table if not exists public.stage_links (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  stage_id   uuid not null references public.stages on delete cascade,
  title      text,
  url        text not null check (url ~* '^https?://'),
  sort_order int  not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists stage_links_stage_idx on public.stage_links(stage_id, sort_order);
create index if not exists stage_links_project_idx on public.stage_links(project_id);

alter table public.stage_links enable row level security;
drop policy if exists "links read"  on public.stage_links;
drop policy if exists "links write" on public.stage_links;
create policy "links read"  on public.stage_links for select using (public.is_approved());
create policy "links write" on public.stage_links for all
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

-- ---------------------------------------------------------------------
-- 5. 선후 관계: pred(앞 단계)가 끝나야 succ(뒤 단계)가 시작
-- ---------------------------------------------------------------------
create table if not exists public.stage_deps (
  project_id uuid not null references public.projects on delete cascade,
  pred_id    uuid not null references public.stages on delete cascade,
  succ_id    uuid not null references public.stages on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pred_id, succ_id),
  check (pred_id <> succ_id)
);
create index if not exists stage_deps_project_idx on public.stage_deps(project_id);
create index if not exists stage_deps_succ_idx on public.stage_deps(succ_id);

alter table public.stage_deps enable row level security;
drop policy if exists "deps read"  on public.stage_deps;
drop policy if exists "deps write" on public.stage_deps;
create policy "deps read"  on public.stage_deps for select using (public.is_approved());
create policy "deps write" on public.stage_deps for all
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

-- ---------------------------------------------------------------------
-- 6. 단계 참조 코드 (예: NPD-K7Q2M) — 지라·컨플루언스에 적어두면 NPD가 찾아옴
-- ---------------------------------------------------------------------
create or replace function public.gen_ref_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  abc  constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  code text;
begin
  loop
    code := 'NPD-';
    for i in 1..5 loop
      code := code || substr(abc, 1 + floor(random() * length(abc))::int, 1);
    end loop;
    exit when not exists (select 1 from public.stages where ref_code = code);
  end loop;
  return code;
end $$;

alter table public.stages add column if not exists ref_code text;
alter table public.stages alter column ref_code set default public.gen_ref_code();
do $$
begin
  perform set_config('npd.skip_log', 'on', true);
  update public.stages set ref_code = public.gen_ref_code() where ref_code is null;
  perform set_config('npd.skip_log', '', true);
end $$;
create unique index if not exists stages_ref_code_idx on public.stages(ref_code);

-- ---------------------------------------------------------------------
-- 7. 진행 기록: 서식(HTML), 수정, 외부 출처(지라·컨플루언스)
-- ---------------------------------------------------------------------
alter table public.stage_logs add column if not exists body_html text;      -- 서식 있는 본문 (body는 검색·내보내기용 글자)
alter table public.stage_logs add column if not exists edited_at timestamptz;
alter table public.stage_logs add column if not exists source text;         -- null: 직접 작성 / jira / confluence
alter table public.stage_logs add column if not exists ext_key text;        -- 예: jira:GAME-12, confluence:123456
alter table public.stage_logs add column if not exists ext_url text;
alter table public.stage_logs add column if not exists ext_title text;
alter table public.stage_logs add column if not exists ext_status text;
create unique index if not exists stage_logs_ext_idx on public.stage_logs(stage_id, ext_key) where ext_key is not null;

-- 작성자는 자기 기록 수정, 편집 권한자는 기록 안 체크박스 체크 가능 ('변경' 기록은 그대로)
drop policy if exists "logs update" on public.stage_logs;
create policy "logs update" on public.stage_logs for update
  using (kind <> 'change' and source is null and (author_id = auth.uid() or public.can_edit_project(project_id)))
  with check (kind <> 'change' and source is null);

-- 단계 설명(주요내용)도 서식 지원
alter table public.stages add column if not exists description_html text;

-- ---------------------------------------------------------------------
-- 8. 외부 연동 상태 (컨플루언스 마지막 수집 시각 등)
-- ---------------------------------------------------------------------
create table if not exists public.integration_state (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.integration_state enable row level security;
drop policy if exists "integration read" on public.integration_state;
create policy "integration read" on public.integration_state for select using (public.is_approved());

-- 화면 자동 갱신
do $$
begin
  begin alter publication supabase_realtime add table public.stage_groups; exception when others then null; end;
  begin alter publication supabase_realtime add table public.stage_checks; exception when others then null; end;
  begin alter publication supabase_realtime add table public.stage_links;  exception when others then null; end;
  begin alter publication supabase_realtime add table public.stage_deps;   exception when others then null; end;
end $$;
