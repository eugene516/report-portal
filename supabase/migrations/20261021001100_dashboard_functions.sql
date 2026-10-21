-- 대시보드 집계 함수
-- dashboard_overview(period): 호출자가 볼 수 있는 광고주(can_access_client)만 집계한다.
--   → 직원은 담당 광고주만, 오너·관리자는 전체
-- staff_overview(): 관리자 이상만. 직원별 역할·담당 광고주
-- staff_directory(): 담당자 추가 시 고를 수 있는 직원 이름·이메일 목록 (직원 누구나)

create or replace function public.dashboard_overview(p_period text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.staff_roles where user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'invalid period' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.name)
    from (
      select c.id, c.name, c.category, c.area,
        coalesce((select jsonb_agg(jsonb_build_object('id', s.user_id, 'name', coalesce(r.display_name, split_part(r.email, '@', 1)), 'primary', s.is_primary) order by s.is_primary desc)
                    from public.client_staff s join public.staff_roles r on r.user_id = s.user_id where s.client_id = c.id), '[]'::jsonb) as staff,
        coalesce((select jsonb_object_agg(service, monthly_target) from public.client_services where client_id = c.id), '{}'::jsonb) as services,
        coalesce((select jsonb_object_agg(channel, jsonb_build_object('contracted', contracted, 'apiConnected', api_connected)) from public.client_ad_channels where client_id = c.id), '{}'::jsonb) as channels,
        (select count(*) from public.blog_posts b where b.client_id = c.id and b.period = p_period) as blog_count,
        (select count(*) from public.blog_posts b
          where b.client_id = c.id and b.period = p_period
            and exists (select 1 from (select r.main_rank, r.blog_tab_rank from public.blog_rank_results r
                                        where r.client_id = c.id and r.keyword = b.keyword order by r.collected_at desc limit 1) lr
                         where lr.main_rank <= 5 or lr.blog_tab_rank <= 5)) as blog_top5,
        (select count(*) from public.tracked_keywords k where k.client_id = c.id and k.kind = 'place' and k.active) as place_total,
        (select count(*) from public.tracked_keywords k
          where k.client_id = c.id and k.kind = 'place' and k.active
            and (select r.rank from public.place_rank_results r where r.client_id = c.id and r.keyword = k.keyword order by r.collected_at desc limit 1) <= 3) as place_top3,
        (select round(avg(lr.rank), 1) from public.tracked_keywords k
           cross join lateral (select r.rank from public.place_rank_results r where r.client_id = c.id and r.keyword = k.keyword order by r.collected_at desc limit 1) lr
          where k.client_id = c.id and k.kind = 'place' and k.active and lr.rank is not null) as place_avg,
        (select max(collected_at) from public.place_rank_results r where r.client_id = c.id) as place_last_at,
        (select max(collected_at) from public.blog_rank_results r where r.client_id = c.id) as blog_last_at,
        (select count(*) from public.cafe_posts p where p.client_id = c.id and p.period = p_period) as cafe_count,
        (select count(*) from public.cafe_posts p where p.client_id = c.id and p.status = '삭제됨') as cafe_deleted,
        (select coalesce(sum(p.views), 0) from public.cafe_posts p where p.client_id = c.id and p.period = p_period) as cafe_views,
        (select count(*) from public.cardnews_rounds n where n.client_id = c.id and n.period = p_period) as card_rounds,
        (select count(*) from public.web_columns w where w.client_id = c.id and w.period = p_period) as column_count,
        (select jsonb_build_object('status', l.status, 'at', l.started_at, 'error', l.error_message)
           from public.naver_sync_logs l where l.client_id = c.id order by l.started_at desc limit 1) as last_sync,
        (select count(*) from public.naver_sync_logs l where l.client_id = c.id and l.status = 'failed' and l.started_at > now() - interval '7 days') as sync_failed_7d
      from public.clients c
      where public.can_access_client(c.id)
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.staff_overview()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.user_id, 'email', r.email, 'name', coalesce(r.display_name, split_part(r.email, '@', 1)), 'role', r.role, 'createdAt', r.created_at,
      'clients', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'primary', s.is_primary) order by c.name)
                             from public.client_staff s join public.clients c on c.id = s.client_id where s.user_id = r.user_id), '[]'::jsonb))
      order by case r.role when 'owner' then 0 when 'admin' then 1 else 2 end, r.email)
    from public.staff_roles r), '[]'::jsonb);
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
  return query select r.user_id, coalesce(r.display_name, split_part(r.email, '@', 1)), r.email from public.staff_roles r order by 2;
end;
$$;

revoke execute on function public.dashboard_overview(text) from public, anon;
revoke execute on function public.staff_overview()        from public, anon;
revoke execute on function public.staff_directory()       from public, anon;
grant  execute on function public.dashboard_overview(text) to authenticated;
grant  execute on function public.staff_overview()        to authenticated;
grant  execute on function public.staff_directory()       to authenticated;
