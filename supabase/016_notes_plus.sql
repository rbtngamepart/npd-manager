-- =====================================================================
-- 업데이트 016: 메모 노션식 기능
--   · 아이콘·커버 · 휴지통(30일) · 내 템플릿 · 즐겨찾기 · 버전 기록
--   · @언급·[[링크]] 기록 (나를 언급한 메모, 이 메모를 가리키는 메모)
--   · 이미지·파일 저장 공간 (Storage 'npd-files', 비공개, 20MB)
-- Supabase SQL Editor에 붙여넣고 Run (여러 번 실행해도 안전, 014·015 다음에)
-- =====================================================================

alter table public.notes add column if not exists icon text;
alter table public.notes add column if not exists cover text;
alter table public.notes add column if not exists deleted_at timestamptz;
alter table public.notes add column if not exists is_template boolean not null default false;
alter table public.notes add column if not exists mention_ids uuid[] not null default '{}';
alter table public.notes add column if not exists ref_note_ids uuid[] not null default '{}';
alter table public.notes add column if not exists ref_stage_ids uuid[] not null default '{}';

create index if not exists notes_mention_idx on public.notes using gin (mention_ids);
create index if not exists notes_ref_note_idx on public.notes using gin (ref_note_ids);
create index if not exists notes_ref_stage_idx on public.notes using gin (ref_stage_ids);
create index if not exists notes_deleted_idx on public.notes (deleted_at);

-- ---- 즐겨찾기 (사람마다) ---------------------------------------------------
create table if not exists public.note_favorites (
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  note_id    uuid not null references public.notes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, note_id)
);
alter table public.note_favorites enable row level security;
drop policy if exists note_favorites_own on public.note_favorites;
create policy note_favorites_own on public.note_favorites for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_approved());

-- ---- 버전 기록 ------------------------------------------------------------
create table if not exists public.note_versions (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid not null references public.notes(id) on delete cascade,
  title      text,
  kind       text,
  body_html  text,
  mindmap    jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists note_versions_note_idx on public.note_versions (note_id, created_at desc);
alter table public.note_versions enable row level security;

-- 메모를 볼 수 있으면 버전도 볼 수 있음 (메모의 권한 규칙이 그대로 적용됨)
drop policy if exists note_versions_select on public.note_versions;
create policy note_versions_select on public.note_versions for select
  using (exists (select 1 from public.notes n where n.id = note_id));

-- 되돌리기 직전 상태를 남길 때: 그 메모를 고칠 수 있는 사람만
drop policy if exists note_versions_insert on public.note_versions;
create policy note_versions_insert on public.note_versions for insert
  with check (exists (
    select 1 from public.notes n
    where n.id = note_id
      and (n.author_id = auth.uid() or (n.visibility = 'shared' and public.is_game_part()))
  ));

-- 고치기 시작할 때(10분 넘게 쉬었다가) 직전 내용을 자동으로 남김, 메모당 50개까지
create or replace function public.notes_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.body_html is distinct from new.body_html
      or old.mindmap is distinct from new.mindmap
      or old.title is distinct from new.title)
     and (old.body_html is not null or old.mindmap is not null)
     and not exists (
       select 1 from public.note_versions v
       where v.note_id = old.id and v.created_at > now() - interval '10 minutes'
     ) then
    insert into public.note_versions (note_id, title, kind, body_html, mindmap, created_by)
    values (old.id, old.title, old.kind, old.body_html, old.mindmap, coalesce(old.updated_by, old.author_id));
    delete from public.note_versions
    where note_id = old.id
      and id not in (select id from public.note_versions where note_id = old.id order by created_at desc limit 50);
  end if;
  return new;
end $$;

drop trigger if exists notes_snapshot on public.notes;
create trigger notes_snapshot before update on public.notes
  for each row execute function public.notes_snapshot();

-- ---- 휴지통: 30일 지난 메모는 완전히 지움 (휴지통을 열 때 부름) -----------
create or replace function public.note_trash_purge()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_approved() then return 0; end if;
  delete from public.notes where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- 이미지·파일 저장 공간 -------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('npd-files', 'npd-files', false, 20971520)
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

    execute 'drop policy if exists npd_files_read on storage.objects';
    execute $p$create policy npd_files_read on storage.objects for select to authenticated
             using (bucket_id = 'npd-files' and public.is_approved())$p$;
    execute 'drop policy if exists npd_files_insert on storage.objects';
    execute $p$create policy npd_files_insert on storage.objects for insert to authenticated
             with check (bucket_id = 'npd-files' and public.is_approved())$p$;
  end if;
end $$;

do $$ begin
  begin alter publication supabase_realtime add table public.note_favorites; exception when others then null; end;
end $$;
