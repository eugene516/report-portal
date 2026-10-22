-- 키워드 TOP 10 (주간·월간): 순위 10위 이내로 거르면 파워링크 특성상 대부분 남아서,
-- 기간 내 노출이 있는 키워드를 모두 돌려주고 화면에서 클릭·노출·광고비 순 상위 10개를 보여준다.
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
           order by x.clk desc, x.imp desc)
      from (select ncc_id, sum(impressions) imp, sum(clicks) clk, sum(cost) cost,
                   count(*) filter (where impressions > 0) days,
                   round(sum(avg_rank * impressions) / nullif(sum(impressions), 0), 1) avg_rank
              from public.naver_entity_daily_stats
             where client_id = p_client and level = 'keyword' and stat_date between p_from and p_to
             group by ncc_id) x
      left join public.naver_campaigns nc on nc.client_id = p_client and nc.ncc_id = x.ncc_id
      left join public.naver_campaigns ag on ag.client_id = p_client and ag.ncc_id = nc.parent_ncc_id
     where x.imp > 0), '[]'::jsonb));
$$;
revoke execute on function public._naver_top_keywords(uuid, date, date) from public, anon, authenticated;
