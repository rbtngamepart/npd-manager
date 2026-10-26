-- =====================================================================
-- 업데이트 005: 부서별 역할 (주관·의결·검토·협의·의견 청취·공유)
-- 004까지 실행한 뒤, 이 파일 내용만 새 쿼리 탭에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- =====================================================================

alter table public.stages add column if not exists dept_roles jsonb not null default '{}'::jsonb;

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
  if new.dept_roles is distinct from old.dept_roles then
    msgs := msgs || format('역할 %s', coalesce(
      (select string_agg(k || ' ' || (v #>> '{}'), ', ' order by k) from jsonb_each(new.dept_roles) as x(k, v)), '없음'));
  end if;
  if array_length(msgs, 1) > 0 then
    insert into public.stage_logs (project_id, stage_id, stage_name, kind, body, author_id)
    values (new.project_id, new.id, new.name, 'change', array_to_string(msgs, ' · '), auth.uid());
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;


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

  -- 부서별 역할의 부서 이름도 변경 (합치는 경우 기존 역할 유지)
  update public.stages
     set dept_roles = jsonb_build_object(n, dept_roles->old_name) || (dept_roles - old_name)
   where dept_roles ? old_name;
  update public.templates t
     set stages = coalesce((
       select jsonb_agg(
                case when jsonb_typeof(e->'dept_roles') = 'object' and (e->'dept_roles') ? old_name
                     then jsonb_set(e, '{dept_roles}', jsonb_build_object(n, e->'dept_roles'->old_name) || ((e->'dept_roles') - old_name))
                     else e end
                order by ord)
       from jsonb_array_elements(t.stages) with ordinality as x(e, ord)
     ), '[]'::jsonb)
   where t.stages::text like '%' || old_name || '%';

  perform set_config('npd.skip_log', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- 역할 종류 (단계에서 부서마다 맡는 역할: 주관, 의결, 검토, 협의 …)
-- ---------------------------------------------------------------------
create table if not exists public.role_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.role_types enable row level security;
drop policy if exists "role_types read"  on public.role_types;
drop policy if exists "role_types write" on public.role_types;
create policy "role_types read"  on public.role_types for select using (public.is_approved());
create policy "role_types write" on public.role_types for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.role_types (name, description, sort_order) values
  ('주관',     '실제로 업무를 수행하고 결과를 책임짐', 0),
  ('의결',     '최종 결정·승인',                       1),
  ('검토',     '결과물을 확인하고 의견·수정 요청',     2),
  ('협의',     '함께 논의해 방향을 정함',              3),
  ('의견 청취', '의견을 듣고, 반영 여부는 주관 부서가 판단', 4),
  ('공유',     '진행 상황만 공유받음',                  5)
on conflict (name) do nothing;

-- 역할 이름 변경 / 합치기: 모든 단계·템플릿에 반영
create or replace function public.rename_role_type(old_name text, new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  n text := btrim(coalesce(new_name, ''));
begin
  if not public.is_admin() then
    raise exception '관리자만 역할 이름을 바꿀 수 있습니다';
  end if;
  if n = '' then
    raise exception '새 역할 이름을 입력하세요';
  end if;
  if old_name = n then
    return;
  end if;

  perform set_config('npd.skip_log', 'on', true);

  if exists (select 1 from public.role_types where name = n) then
    delete from public.role_types where name = old_name;
  else
    update public.role_types set name = n where name = old_name;
  end if;

  update public.stages s
     set dept_roles = (
       select coalesce(jsonb_object_agg(k, case when v #>> '{}' = old_name then to_jsonb(n) else v end), '{}'::jsonb)
       from jsonb_each(s.dept_roles) as x(k, v))
   where exists (select 1 from jsonb_each_text(s.dept_roles) as y(k, v) where v = old_name);

  update public.templates t
     set stages = coalesce((
       select jsonb_agg(
                case when jsonb_typeof(e->'dept_roles') = 'object' then
                  jsonb_set(e, '{dept_roles}', (
                    select coalesce(jsonb_object_agg(k, case when v #>> '{}' = old_name then to_jsonb(n) else v end), '{}'::jsonb)
                    from jsonb_each(e->'dept_roles') as x(k, v)))
                else e end
                order by ord)
       from jsonb_array_elements(t.stages) with ordinality as x(e, ord)
     ), '[]'::jsonb)
   where t.stages::text like '%' || old_name || '%';

  perform set_config('npd.skip_log', 'off', true);
end $$;

