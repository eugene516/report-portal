-- 플레이스 진행률 = 오늘(한국시간) 순위를 확인한 고정 키워드 비율 (전부 확인하면 100%)

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
        (select count(*) from public.naver_sync_logs l where l.client_id = c.id and l.status = 'failed' and l.started_at > now() - interval '7 days') as sync_failed_7d,
        jsonb_build_object(
          'blog',  (select max(collected_at) from public.blog_rank_results r where r.client_id = c.id),
          'place', (select max(collected_at) from public.place_rank_results r where r.client_id = c.id),
          'cafe',  (select max(greatest(captured_at, checked_at)) from public.cafe_posts p where p.client_id = c.id),
          'naver', (select max(l.started_at) from public.naver_sync_logs l where l.client_id = c.id and l.status = 'success')) as collected,
        coalesce((select jsonb_agg(s.service) from public.client_services s where s.client_id = c.id), '[]'::jsonb) as services,
        (select jsonb_build_object('total', count(*), 'top3', count(*) filter (where lr.rank <= 3), 'ranked', count(lr.rank),
                'checked', count(*) filter (where (lr.at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date))
           from public.tracked_keywords k
           left join lateral (select r.rank, r.collected_at as at from public.place_rank_results r where r.client_id = c.id and r.keyword = k.keyword
                               and r.collected_at < v_to + 1 order by r.collected_at desc limit 1) lr on true
          where k.client_id = c.id and k.kind = 'place' and k.active) as place
      from public.clients c
      where public.can_access_client(c.id) and (p_client is null or c.id = p_client)
    ) x), '[]'::jsonb);
end;
$$;
