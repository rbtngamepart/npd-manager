-- =====================================================================
-- 업데이트 003: 관리자 부서 관리 (부서 목록, 이름 변경·합치기)
-- 002를 실행한 뒤, 이 파일을 SQL Editor에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- =====================================================================

-- 일정이 바뀌면 자동으로 '변경' 기록을 남김
create or replace function public.log_stage_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  msgs text[] := '{}';
  f text := 'MM/DD';
begin
  -- 관리자 부서명 일괄 변경 중에는 기록 생략
  if coalesce(current_setting('npd.skip_log', true), '') = 'on' then
    new.updated_at := now();
    return new;
  end if;
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


-- ---------------------------------------------------------------------
-- 부서 목록 (관리자가 사이트의 [사용자 관리 > 부서] 탭에서 관리)
-- ---------------------------------------------------------------------
create table if not exists public.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

alter table public.departments enable row level security;
drop policy if exists "departments read"  on public.departments;
drop policy if exists "departments write" on public.departments;
create policy "departments read"  on public.departments for select using (public.is_approved());
create policy "departments write" on public.departments for all
  using (public.is_admin()) with check (public.is_admin());

-- 지금까지 쓰인 부서명을 목록으로 옮겨 담기 (처음 한 번)
insert into public.departments (name, sort_order)
select name, (row_number() over (order by case when name = '게임파트' then 0 else 1 end, name))::int - 1
from (
  select '게임파트' as name
  union select '구매물류팀'
  union select btrim(department) from public.stages where coalesce(btrim(department), '') <> ''
  union select btrim(unnest(related_departments)) from public.stages
  union select btrim(department) from public.profiles where coalesce(btrim(department), '') <> ''
) x
where coalesce(name, '') <> ''
on conflict (name) do nothing;

-- 부서명 변경 / 합치기: 단계(담당·연관), 사용자, 템플릿에 한 번에 반영
create or replace function public.rename_department(old_name text, new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  n text := btrim(coalesce(new_name, ''));
begin
  if not public.is_admin() then
    raise exception '관리자만 부서명을 바꿀 수 있습니다';
  end if;
  if n = '' then
    raise exception '새 부서명을 입력하세요';
  end if;
  if old_name = n then
    return;
  end if;

  perform set_config('npd.skip_log', 'on', true);

  if exists (select 1 from public.departments where name = n) then
    delete from public.departments where name = old_name;          -- 합치기
  else
    update public.departments set name = n where name = old_name;  -- 이름 변경
    if not found then
      insert into public.departments (name, sort_order)
      values (n, coalesce((select max(sort_order) + 1 from public.departments), 0));
    end if;
  end if;

  update public.stages set department = n where department = old_name;
  update public.stages
     set related_departments = array_remove(
           array(select distinct x from unnest(array_replace(related_departments, old_name, n)) as x),
           department)
   where old_name = any(related_departments);
  update public.stages
     set related_departments = array_remove(related_departments, department)
   where department = n and n = any(related_departments);
  update public.profiles set department = n where department = old_name;

  update public.templates t
     set stages = coalesce((
       select jsonb_agg(
                (case when e->>'department' = old_name then jsonb_set(e, '{department}', to_jsonb(n)) else e end)
                || case when jsonb_typeof(e->'related_departments') = 'array' then
                     jsonb_build_object('related_departments', (
                       select coalesce(jsonb_agg(distinct case when r = old_name then n else r end), '[]'::jsonb)
                       from jsonb_array_elements_text(e->'related_departments') as r
                       where (case when r = old_name then n else r end)
                             is distinct from (case when e->>'department' = old_name then n else e->>'department' end)))
                   else '{}'::jsonb end
                order by ord)
       from jsonb_array_elements(t.stages) with ordinality as x(e, ord)
     ), '[]'::jsonb)
   where t.stages::text like '%' || old_name || '%';

  perform set_config('npd.skip_log', 'off', true);
end $$;

