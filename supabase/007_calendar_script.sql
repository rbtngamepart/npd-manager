-- =====================================================================
-- 업데이트 007: Apps Script로 캘린더 연결 (회사 계정에서 'iCal 비공개 주소'가 막혀 있을 때)
-- 006까지 실행한 뒤, 이 파일 내용만 새 쿼리 탭에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- =====================================================================

-- 연결 방식: ics(비공개 주소를 서버가 읽음) / script(각자 Apps Script가 일정을 보내줌)
alter table public.calendar_sources add column if not exists kind text not null default 'ics';
alter table public.calendar_sources add column if not exists token_hash text;
alter table public.calendar_sources alter column ics_url drop not null;

alter table public.calendar_sources drop constraint if exists calendar_sources_ics_url_check;
alter table public.calendar_sources drop constraint if exists calendar_sources_kind_chk;
alter table public.calendar_sources add constraint calendar_sources_kind_chk check (
  (kind = 'ics'    and ics_url is not null and ics_url like 'https://calendar.google.com/calendar/ical/%')
  or (kind = 'script' and ics_url is null)
);
create unique index if not exists calendar_sources_token_idx on public.calendar_sources(token_hash) where token_hash is not null;

-- 연결 현황 (주소·코드는 빼고)
drop function if exists public.calendar_sources_overview();
create function public.calendar_sources_overview()
returns table (id uuid, owner_id uuid, label text, kind text, enabled boolean, last_synced_at timestamptz, last_error text, event_count int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, owner_id, label, kind, enabled, last_synced_at, last_error, event_count, created_at
  from public.calendar_sources
  where public.is_approved()
  order by created_at
$$;

-- Apps Script 연결 코드 만들기 (p_id를 주면 그 연결의 코드를 새로 발급 → 이전 코드는 더 이상 안 됨)
-- 코드는 이때 한 번만 돌려주고, DB에는 해시만 저장
create or replace function public.calendar_script_issue(p_label text default null, p_id uuid default null)
returns table (id uuid, token text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  t   text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  h   text := encode(sha256(convert_to(t, 'UTF8')), 'hex');
  sid uuid;
begin
  if auth.uid() is null or not public.is_approved() then
    raise exception '승인된 사용자만 사용할 수 있습니다';
  end if;
  if p_id is null then
    insert into public.calendar_sources (owner_id, label, kind, ics_url, token_hash)
    values (auth.uid(), nullif(trim(coalesce(p_label, '')), ''), 'script', null, h)
    returning calendar_sources.id into sid;
  else
    update public.calendar_sources s
       set token_hash = h, last_error = null, enabled = true
     where s.id = p_id and s.owner_id = auth.uid() and s.kind = 'script'
    returning s.id into sid;
    if sid is null then
      raise exception '캘린더 연결을 찾을 수 없습니다';
    end if;
  end if;
  return query select sid, t;
end $$;
