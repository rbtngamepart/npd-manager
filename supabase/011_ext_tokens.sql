-- =====================================================================
-- 업데이트 011: 크롬 확장 프로그램 연결 코드 (구글 캘린더에서 NPD 단계 고르기)
-- 010까지 실행한 뒤, 이 파일 내용만 새 쿼리 탭에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- =====================================================================
create table if not exists public.ext_tokens (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  label        text,
  token_hash   text not null unique,     -- 코드는 저장하지 않고 해시만
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.ext_tokens enable row level security;
drop policy if exists "ext tokens own" on public.ext_tokens;
create policy "ext tokens own" on public.ext_tokens for select using (owner_id = auth.uid());
drop policy if exists "ext tokens delete own" on public.ext_tokens;
create policy "ext tokens delete own" on public.ext_tokens for delete using (owner_id = auth.uid());

-- 연결 코드 발급 (코드는 이때 한 번만 돌려줌)
create or replace function public.ext_token_issue(p_label text default null)
returns table (id uuid, token text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  t   text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  sid uuid;
begin
  if auth.uid() is null or not public.is_approved() then
    raise exception '승인된 사용자만 사용할 수 있습니다';
  end if;
  insert into public.ext_tokens (owner_id, label, token_hash)
  values (auth.uid(), nullif(trim(coalesce(p_label, '')), ''), encode(sha256(convert_to(t, 'UTF8')), 'hex'))
  returning ext_tokens.id into sid;
  return query select sid, t;
end $$;
