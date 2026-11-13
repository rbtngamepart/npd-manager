-- =====================================================================
-- 업데이트 012: 지라·컨플루언스 기록 '연결 해제됨' 표시 + NPD에서 지우기
-- 011까지 실행한 뒤, 이 파일 내용만 새 쿼리 탭에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- =====================================================================
alter table public.stage_logs add column if not exists ext_detached_at timestamptz; -- 원문에서 단계 코드가 빠진 때 (기록은 남김)
alter table public.stage_logs add column if not exists ext_deleted_at timestamptz;  -- NPD에서 지운 때 (다시 수집하지 않음)

-- 수집된 기록 지우기: 그 프로젝트 편집 권한이 있으면
create or replace function public.ext_log_hide(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.stage_logs
     set ext_deleted_at = now()
   where id = any(p_ids)
     and source is not null
     and ext_deleted_at is null
     and public.can_edit_project(project_id);
  get diagnostics n = row_count;
  return n;
end $$;
