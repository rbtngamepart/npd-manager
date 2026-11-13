-- =====================================================================
-- 업데이트 013: NPD에서 지운 지라·컨플루언스 기록 되살리기
-- 012까지 실행한 뒤, 이 파일 내용만 새 쿼리 탭에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- =====================================================================
create or replace function public.ext_log_restore(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.stage_logs
     set ext_deleted_at = null
   where id = any(p_ids)
     and source is not null
     and ext_deleted_at is not null
     and public.can_edit_project(project_id);
  get diagnostics n = row_count;
  return n;
end $$;
