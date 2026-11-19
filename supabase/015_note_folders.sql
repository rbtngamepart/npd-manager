-- =====================================================================
-- 업데이트 015: 메모 폴더 (폴더 안에 폴더, 끝없이)
--   · 폴더도 👥 팀 공개 / 🔒 나만 보기
--   · 폴더를 지우면 안의 메모·하위 폴더는 한 칸 위로 (메모는 지우지 않음)
-- Supabase SQL Editor에 붙여넣고 Run (여러 번 실행해도 안전, 014 다음에)
-- =====================================================================

create table if not exists public.note_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '새 폴더',
  parent_id   uuid references public.note_folders(id) on delete set null,
  sort_order  double precision not null default 0,
  visibility  text not null default 'shared' check (visibility in ('shared', 'private')),
  owner_id    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists note_folders_parent_idx on public.note_folders (parent_id);

alter table public.notes add column if not exists folder_id uuid references public.note_folders(id) on delete set null;
create index if not exists notes_folder_idx on public.notes (folder_id);

-- 주인·공개 범위 보호, 자기 안으로 옮기기 막기
create or replace function public.note_folders_touch()
returns trigger language plpgsql security definer set search_path = public as $$
declare cur uuid; depth int := 0;
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(auth.uid(), new.owner_id);
    new.created_at := now();
  else
    if auth.uid() is not null and old.owner_id is distinct from auth.uid() then
      new.owner_id := old.owner_id;
      new.visibility := old.visibility;
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.name := coalesce(nullif(btrim(new.name), ''), '새 폴더');
  cur := new.parent_id;
  while cur is not null loop
    if cur = new.id then
      raise exception '폴더를 자기 안(하위 폴더)으로 옮길 수 없습니다';
    end if;
    depth := depth + 1;
    exit when depth > 200;
    select parent_id into cur from public.note_folders where id = cur;
  end loop;
  return new;
end $$;

drop trigger if exists note_folders_touch on public.note_folders;
create trigger note_folders_touch before insert or update on public.note_folders
  for each row execute function public.note_folders_touch();

alter table public.note_folders enable row level security;

drop policy if exists note_folders_select on public.note_folders;
create policy note_folders_select on public.note_folders for select
  using (public.is_approved() and (visibility = 'shared' or owner_id = auth.uid()));

drop policy if exists note_folders_insert on public.note_folders;
create policy note_folders_insert on public.note_folders for insert
  with check (public.is_approved());

drop policy if exists note_folders_update on public.note_folders;
create policy note_folders_update on public.note_folders for update
  using (owner_id = auth.uid() or (visibility = 'shared' and public.is_game_part()))
  with check (owner_id = auth.uid() or (visibility = 'shared' and public.is_game_part()));

-- 직접 지우기는 막고, 아래 함수로만 (안의 내용을 한 칸 위로 옮긴 뒤 지움)
drop policy if exists note_folders_delete on public.note_folders;

create or replace function public.note_folder_delete(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare f public.note_folders;
begin
  select * into f from public.note_folders where id = p_id;
  if not found then return false; end if;
  if not (f.owner_id = auth.uid()
          or (f.visibility = 'shared' and public.is_game_part())
          or public.is_admin()) then
    raise exception '이 폴더를 지울 권한이 없습니다';
  end if;
  update public.notes set folder_id = f.parent_id where folder_id = p_id;
  update public.note_folders set parent_id = f.parent_id where parent_id = p_id;
  delete from public.note_folders where id = p_id;
  return true;
end $$;

do $$ begin
  begin alter publication supabase_realtime add table public.note_folders; exception when others then null; end;
end $$;
