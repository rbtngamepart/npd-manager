-- =====================================================================
-- 업데이트 002: 연관부서
-- 이미 schema.sql을 실행한 Supabase에서 이 파일만 SQL Editor에 붙여넣고 Run 하세요.
-- (여러 번 실행해도 안전합니다)
-- =====================================================================

alter table public.stages add column if not exists related_departments text[] not null default '{}';
create index if not exists stages_related_idx on public.stages using gin(related_departments);

-- 일정이 바뀌면 자동으로 '변경' 기록을 남김
create or replace function public.log_stage_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  msgs text[] := '{}';
  f text := 'MM/DD';
begin
  if new.plan_start is distinct from old.plan_start or new.plan_end is distinct from old.plan_end then
    msgs := msgs || format('계획 %s~%s → %s~%s',
      coalesce(to_char(old.plan_start, f), '-'), coalesce(to_char(old.plan_end, f), '-'),
      coalesce(to_char(new.plan_start, f), '-'), coalesce(to_char(new.plan_end, f), '-'));
  end if;
  if new.expected_end is distinct from old.expected_end then
    msgs := msgs || format('예상 완료 %s → %s',
      coalesce(to_char(old.expected_end, f), '-'), coalesce(to_char(new.expected_end, f), '-'));
  end if;
  if new.actual_start is distinct from old.actual_start and new.actual_start is not null then
    msgs := msgs || format('실제 시작 %s', to_char(new.actual_start, f));
  end if;
  if new.actual_end is distinct from old.actual_end and new.actual_end is not null then
    msgs := msgs || format('완료 처리 %s', to_char(new.actual_end, f));
  end if;
  if new.pm_status is distinct from old.pm_status then
    msgs := msgs || format('PM 판단 %s → %s',
      coalesce(old.pm_status, '없음'), coalesce(new.pm_status, '없음'));
  end if;
  if new.department is distinct from old.department then
    msgs := msgs || format('담당부서 %s → %s', coalesce(old.department, '-'), coalesce(new.department, '-'));
  end if;
  if new.related_departments is distinct from old.related_departments then
    msgs := msgs || format('연관부서 %s',
      coalesce(nullif(array_to_string(new.related_departments, ', '), ''), '없음'));
  end if;
  if array_length(msgs, 1) > 0 then
    insert into public.stage_logs (project_id, stage_id, stage_name, kind, body, author_id)
    values (new.project_id, new.id, new.name, 'change', array_to_string(msgs, ' · '), auth.uid());
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

