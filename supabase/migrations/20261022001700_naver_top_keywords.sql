-- 네이버 광고: 기간 내 평균 노출 순위 10위 이내 키워드 (주간·월간 보기)
-- 평균 순위 = 일별 평균 순위를 노출수로 가중 평균 (네이버 광고 관리자와 같은 방식)

create or replace function public._naver_top_keywords(p_client uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('from', p_from, 'to', p_to, 'keywords', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.ncc_id, 'keyword', coalesce(nc.name, x.ncc_id), 'adgroup', coalesce(ag.name, ''),
             'avgRank', x.avg_rank, 'impressions', x.imp, 'clicks', x.clk, 'cost', x.cost,
             'ctr', case when x.imp > 0 then round(x.clk::numeric / x.imp * 100, 2) end,
             'cpc', case when x.clk > 0 then round(x.cost / x.clk, 0) end,
             'days', x.days)
           order by x.avg_rank, x.imp desc)
      from (select ncc_id, sum(impressions) imp, sum(clicks) clk, sum(cost) cost,
                   count(*) filter (where impressions > 0) days,
                   round(sum(avg_rank * impressions) / nullif(sum(impressions), 0), 1) avg_rank
              from public.naver_entity_daily_stats
             where client_id = p_client and level = 'keyword' and stat_date between p_from and p_to and avg_rank is not null
             group by ncc_id) x
      left join public.naver_campaigns nc on nc.client_id = p_client and nc.ncc_id = x.ncc_id
      left join public.naver_campaigns ag on ag.client_id = p_client and ag.ncc_id = nc.parent_ncc_id
     where x.imp > 0 and x.avg_rank <= 10), '[]'::jsonb));
$$;

create or replace function public.report_naver_keywords(p_token text, p_from date, p_to date)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := public.resolve_client_token(p_token);
begin
  if v is null then return null; end if;
  perform public._check_range(p_from, p_to);
  if not exists (select 1 from public.client_ad_channels
                  where client_id = v and channel = 'naver' and contracted and api_connected) then
    return null;
  end if;
  return public._naver_top_keywords(v, p_from, p_to);
end;
$$;

create or replace function public.staff_report_naver_keywords(p_client uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public._check_range(p_from, p_to);
  if not exists (select 1 from public.client_ad_channels
                  where client_id = p_client and channel = 'naver' and contracted and api_connected) then
    return null;
  end if;
  return public._naver_top_keywords(p_client, p_from, p_to);
end;
$$;

revoke execute on function public._naver_top_keywords(uuid, date, date)        from public, anon, authenticated;
revoke execute on function public.report_naver_keywords(text, date, date)      from public;
revoke execute on function public.staff_report_naver_keywords(uuid, date, date) from public, anon;
grant  execute on function public.report_naver_keywords(text, date, date)      to anon, authenticated;
grant  execute on function public.staff_report_naver_keywords(uuid, date, date) to authenticated;
