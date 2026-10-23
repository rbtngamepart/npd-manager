-- =====================================================================
-- 업데이트 004: 사용자 초대 (미리 등록한 메일은 로그인 즉시 승인)
-- 003까지 실행한 뒤, 이 파일을 SQL Editor에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- =====================================================================

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

