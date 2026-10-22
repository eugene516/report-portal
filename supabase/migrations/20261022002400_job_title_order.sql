-- 직급 순서: 대표 · 이사 · 부장 · 차장 · 과장 · 대리 · 주임 · 사원 (직급 없음은 맨 뒤)
-- 직원 목록·담당자 선택 목록·업무 보드 멤버는 모두 이 순서로 보여준다.

alter table public.staff_roles  drop constraint staff_roles_job_title_check;
alter table public.task_members drop constraint task_members_job_title_check;
alter table public.staff_roles  add constraint staff_roles_job_title_check
  check (job_title is null or job_title in ('대표', '이사', '부장', '차장', '과장', '대리', '주임', '사원'));
alter table public.task_members add constraint task_members_job_title_check
  check (job_title is null or job_title in ('대표', '이사', '부장', '차장', '과장', '대리', '주임', '사원'));

create or replace function public.job_rank(p_title text)
returns int language sql immutable set search_path = ''
as $$ select coalesce(array_position(array['대표', '이사', '부장', '차장', '과장', '대리', '주임', '사원'], p_title), 99); $$;
grant execute on function public.job_rank(text) to authenticated;

create or replace function public.staff_overview()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.user_id, 'email', r.email, 'name', coalesce(r.display_name, split_part(r.email, '@', 1)), 'role', r.role, 'createdAt', r.created_at,
      'jobTitle', r.job_title, 'duty', r.duty,
      'mustChange', r.must_change_password, 'invitedAt', r.invited_at, 'mailedAt', r.invite_mailed_at, 'lastSignIn', u.last_sign_in_at,
      'clients', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'primary', s.is_primary) order by c.name)
                             from public.client_staff s join public.clients c on c.id = s.client_id where s.user_id = r.user_id), '[]'::jsonb))
      order by public.job_rank(r.job_title), case r.role when 'owner' then 0 when 'admin' then 1 else 2 end, coalesce(r.display_name, r.email))
    from public.staff_roles r left join auth.users u on u.id = r.user_id), '[]'::jsonb);
end;
$$;

create or replace function public.staff_directory()
returns table (id uuid, name text, email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.staff_roles where user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select r.user_id, coalesce(r.display_name, split_part(r.email, '@', 1)), r.email
                 from public.staff_roles r order by public.job_rank(r.job_title), 2;
end;
$$;

-- 광고주별 담당 직원 목록(대시보드)도 주담당 다음은 직급 순
create or replace function public.month_overview(p_period text, p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_from date; v_to date;
begin
  if not exists (select 1 from public.staff_roles where user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid period' using errcode = '22023'; end if;
  if p_client is not null and not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_from := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_to := (v_from + interval '1 month - 1 day')::date;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.name)
    from (
      select c.id, c.name, c.category, c.area,
        coalesce((select jsonb_agg(jsonb_build_object('id', s.user_id, 'name', coalesce(r.display_name, split_part(r.email, '@', 1)), 'primary', s.is_primary)
                                   order by s.is_primary desc, public.job_rank(r.job_title))
                    from public.client_staff s join public.staff_roles r on r.user_id = s.user_id where s.client_id = c.id), '[]'::jsonb) as staff,
        (select jsonb_build_object('amount', m.amount, 'startsOn', m.starts_on, 'endsOn', m.ends_on, 'memo', m.memo, 'updatedAt', m.updated_at)
           from public.client_month_contracts m where m.client_id = c.id and m.period = p_period) as contract,
        public._contract_items(c.id, p_period) as items,
        coalesce((select jsonb_object_agg(ch.channel, jsonb_build_object(
            'contracted', ch.contracted, 'apiConnected', ch.api_connected, 'budget', ch.monthly_budget,
            'spent', case when ch.channel = 'naver' then (select coalesce(sum(d.cost), 0) from public.naver_daily_stats d
                                                           where d.client_id = c.id and d.stat_date between v_from and v_to) end))
           from public.client_ad_channels ch where ch.client_id = c.id), '{}'::jsonb) as channels,
        (select count(*) from public.client_quotes q where q.client_id = c.id and q.period = p_period) as files,
        (select count(*) from public.cafe_posts p where p.client_id = c.id and p.period = p_period and p.status = '삭제됨') as cafe_deleted,
        (select count(*) from public.naver_sync_logs l where l.client_id = c.id and l.status = 'failed' and l.started_at > now() - interval '7 days') as sync_failed_7d
      from public.clients c
      where public.can_access_client(c.id) and (p_client is null or c.id = p_client)
    ) x), '[]'::jsonb);
end;
$$;
