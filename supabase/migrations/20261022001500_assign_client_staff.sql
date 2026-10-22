-- 광고주별 담당 직원 일괄 변경 (오너·관리자 전용)
-- 주담당 1명 + 보조 담당 여러 명을 한 번에 바꾼다. 중간에 실패하면 전체가 취소되어 주담당이 비는 일이 없다.

create or replace function public.set_client_staff(p_client uuid, p_primary uuid, p_support uuid[])
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_support uuid[] := array(select distinct u from unnest(coalesce(p_support, '{}')) u where u is distinct from p_primary);
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients where id = p_client) then
    raise exception 'client not found' using errcode = 'P0002';
  end if;
  if p_primary is null then
    raise exception 'primary required' using errcode = '22023';
  end if;
  -- 직원 명단(staff_roles)에 있는 계정만 배정할 수 있다
  if exists (select 1 from unnest(array_append(v_support, p_primary)) u
             where not exists (select 1 from public.staff_roles r where r.user_id = u)) then
    raise exception 'unknown staff' using errcode = '22023';
  end if;

  delete from public.client_staff where client_id = p_client;
  insert into public.client_staff (client_id, user_id, is_primary, created_by)
  select p_client, p_primary, true, auth.uid()
  union all
  select p_client, u, false, auth.uid() from unnest(v_support) u;
end;
$$;

revoke execute on function public.set_client_staff(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.set_client_staff(uuid, uuid, uuid[]) to authenticated;
