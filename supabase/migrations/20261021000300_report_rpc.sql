-- 리포트 화면이 데이터를 읽는 함수
--   * 광고주 화면(/r/{token}) : report_* (token 검증 후 해당 광고주 데이터만)
--   * 직원 화면(/admin/...)   : staff_* (로그인 + 직원 권한 확인)
--   * 실제 집계는 내부 함수(_naver_report)가 하고, 외부에는 노출하지 않는다.
--   * 화면은 DB만 읽는다. 네이버 API를 직접 호출하지 않는다.

-- 내부: 광고주 기본 정보 + 채널 계약 상태 ------------------------------------------
create or replace function public._client_summary(p_client uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'category', c.category, 'area', c.area,
    'channels', coalesce((
      select jsonb_object_agg(ch.channel, jsonb_build_object('contracted', ch.contracted, 'apiConnected', ch.api_connected))
        from public.client_ad_channels ch where ch.client_id = c.id), '{}'::jsonb)
  )
  from public.clients c where c.id = p_client;
$$;

-- 내부: 네이버 성과 집계 ---------------------------------------------------------
create or replace function public._naver_report(p_client uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with s as (
    select * from public.naver_daily_stats
     where client_id = p_client and stat_date between p_from and p_to
  ), tot as (
    select coalesce(sum(cost), 0) cost, coalesce(sum(impressions), 0) imp, coalesce(sum(clicks), 0) clk,
           coalesce(sum(conversions), 0) conv, coalesce(sum(conversion_revenue), 0) rev
      from s
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'kpi', (select jsonb_build_object(
              'cost', cost, 'impressions', imp, 'clicks', clk,
              'ctr',  case when imp > 0 then round(clk::numeric / imp * 100, 2) end,
              'cpc',  case when clk > 0 then round(cost / clk, 0) end,
              'conversions', conv,
              'roas', case when cost > 0 then round(rev / cost * 100, 1) end) from tot),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'cost', cost, 'impressions', imp, 'clicks', clk, 'conversions', conv) order by d)
        from (select stat_date d, sum(cost) cost, sum(impressions) imp, sum(clicks) clk, sum(conversions) conv
                from s group by stat_date) x), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.ncc_campaign_id, 'name', coalesce(nc.name, x.ncc_campaign_id),
               'cost', x.cost, 'impressions', x.imp, 'clicks', x.clk,
               'ctr', case when x.imp > 0 then round(x.clk::numeric / x.imp * 100, 2) end,
               'cpc', case when x.clk > 0 then round(x.cost / x.clk, 0) end,
               'avgRank', x.avg_rank, 'conversions', x.conv,
               'roas', case when x.cost > 0 then round(x.rev / x.cost * 100, 1) end) order by x.cost desc)
        from (select ncc_campaign_id, sum(cost) cost, sum(impressions) imp, sum(clicks) clk,
                     sum(conversions) conv, sum(conversion_revenue) rev,
                     round(sum(avg_rank * impressions) / nullif(sum(impressions), 0), 2) avg_rank
                from s group by ncc_campaign_id) x
        left join public.naver_campaigns nc
          on nc.client_id = p_client and nc.ncc_id = x.ncc_campaign_id), '[]'::jsonb),
    'lastCollectedAt', (select max(collected_at) from public.naver_daily_stats where client_id = p_client)
  );
$$;

revoke execute on function public._client_summary(uuid)            from public, anon, authenticated;
revoke execute on function public._naver_report(uuid, date, date)  from public, anon, authenticated;

-- 기간 검증 (최대 1년) ------------------------------------------------------------
create or replace function public._check_range(p_from date, p_to date)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'invalid range' using errcode = '22023';
  end if;
end;
$$;

-- 광고주 화면 (anon 호출 가능, 토큰으로만 접근) -------------------------------------
create or replace function public.report_client(p_token text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := public.resolve_client_token(p_token);
begin
  if v is null then return null; end if;   -- 존재 여부를 구분해 알려주지 않는다
  return public._client_summary(v);
end;
$$;

create or replace function public.report_naver(p_token text, p_from date, p_to date)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := public.resolve_client_token(p_token);
begin
  if v is null then return null; end if;
  perform public._check_range(p_from, p_to);
  if not exists (select 1 from public.client_ad_channels
                  where client_id = v and channel = 'naver' and contracted and api_connected) then
    return jsonb_build_object('notContracted', true);
  end if;
  return public._naver_report(v, p_from, p_to);
end;
$$;

-- 직원 화면 (로그인 + 직원 권한) -------------------------------------------------
create or replace function public.staff_report_client(p_client uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return public._client_summary(p_client);
end;
$$;

create or replace function public.staff_report_naver(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public._check_range(p_from, p_to);
  if not exists (select 1 from public.client_ad_channels
                  where client_id = p_client and channel = 'naver' and contracted and api_connected) then
    return jsonb_build_object('notContracted', true);
  end if;
  return public._naver_report(p_client, p_from, p_to);
end;
$$;

revoke execute on function public.report_client(text)                      from public;
revoke execute on function public.report_naver(text, date, date)           from public;
revoke execute on function public.staff_report_client(uuid)                from public, anon;
revoke execute on function public.staff_report_naver(uuid, date, date)     from public, anon;
grant  execute on function public.report_client(text)                      to anon, authenticated;
grant  execute on function public.report_naver(text, date, date)           to anon, authenticated;
grant  execute on function public.staff_report_client(uuid)                to authenticated;
grant  execute on function public.staff_report_naver(uuid, date, date)     to authenticated;
