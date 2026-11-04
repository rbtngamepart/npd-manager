-- =====================================================================
-- 업데이트 009: 단계 아래 하위 단계 (간트에서 단계를 끌어 다른 단계 위에 놓기)
-- 008까지 실행한 뒤, 이 파일 내용만 새 쿼리 탭에 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- =====================================================================

-- 상위 단계 (상위 단계를 지우면 화면에서 하위 단계를 한 칸 위로 옮긴 뒤 지움)
alter table public.stages add column if not exists parent_id uuid references public.stages on delete set null;
create index if not exists stages_parent_idx on public.stages(parent_id);

-- 자기 자신이나 자기 아래 단계를 상위로 지정하지 못하게
create or replace function public.check_stage_parent()
returns trigger language plpgsql set search_path = public as $$
declare
  p uuid := new.parent_id;
  guard int := 0;
begin
  if p is null then return new; end if;
  if p = new.id then raise exception '자기 자신 아래로는 넣을 수 없습니다'; end if;
  while p is not null and guard < 200 loop
    if p = new.id then raise exception '자기 하위 단계 아래로는 넣을 수 없습니다'; end if;
    select parent_id into p from public.stages where id = p;
    guard := guard + 1;
  end loop;
  return new;
end $$;
drop trigger if exists stages_check_parent on public.stages;
create trigger stages_check_parent before insert or update of parent_id on public.stages
  for each row execute function public.check_stage_parent();
