-- =====================================================================
-- 업데이트 014: 메모 (회의록·아이디어·자유 메모, 문서/마인드맵)
--   · 프로젝트와 상관없이 쓸 수 있고, 필요하면 프로젝트·단계에 연결
--   · 팀 공개(게임파트가 함께 편집) / 나만 보기
-- Supabase SQL Editor에 붙여넣고 Run (여러 번 실행해도 안전)
-- =====================================================================

create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default '',
  kind        text not null default 'doc' check (kind in ('doc', 'mindmap')),
  category    text not null default 'memo' check (category in ('memo', 'meeting', 'idea')),
  note_date   date not null default ((now() at time zone 'Asia/Seoul')::date),
  body_html   text,
  body_text   text,
  mindmap     jsonb,
  project_id  uuid references public.projects(id) on delete set null,
  stage_ids   uuid[] not null default '{}',
  visibility  text not null default 'shared' check (visibility in ('shared', 'private')),
  author_id   uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists notes_updated_idx on public.notes (updated_at desc);
create index if not exists notes_project_idx on public.notes (project_id);
create index if not exists notes_stage_ids_idx on public.notes using gin (stage_ids);

-- 고친 사람·시간 자동, 작성자·공개 범위는 작성자만 바꿀 수 있음
create or replace function public.notes_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := coalesce(auth.uid(), new.author_id);
    new.updated_by := new.author_id;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if auth.uid() is not null and old.author_id is distinct from auth.uid() then
    new.author_id := old.author_id;
    new.visibility := old.visibility;
  end if;
  new.created_at := old.created_at;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before insert or update on public.notes
  for each row execute function public.notes_touch();

alter table public.notes enable row level security;

drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes for select
  using (public.is_approved() and (visibility = 'shared' or author_id = auth.uid()));

drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes for insert
  with check (public.is_approved());

drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes for update
  using (author_id = auth.uid() or (visibility = 'shared' and public.is_game_part()))
  with check (author_id = auth.uid() or (visibility = 'shared' and public.is_game_part()));

drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes for delete
  using (author_id = auth.uid() or public.is_admin());

do $$ begin
  begin alter publication supabase_realtime add table public.notes; exception when others then null; end;
end $$;
