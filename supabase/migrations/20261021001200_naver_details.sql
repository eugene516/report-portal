-- 네이버 광고 상세 리포트: 광고그룹·키워드별 성과, 비즈머니 잔액, 월 예산, 담당자 코멘트
-- 공식 문서 확인(2026-10-21): GET /billing/bizmoney, GET /ncc/keywords?nccAdgroupId=…(recordSize 최대 1000)

-- 키워드도 엔티티로 저장 (이름·입찰가)
alter table public.naver_campaigns drop constraint naver_campaigns_entity_type_check;
alter table public.naver_campaigns add constraint naver_campaigns_entity_type_check check (entity_type in ('campaign', 'adgroup', 'keyword'));
alter table public.naver_campaigns add column if not exists bid_amt int;

-- 광고그룹 · 키워드 단위 일별 성과
create table public.naver_entity_daily_stats (
  client_id           uuid not null references public.clients (id) on delete cascade,
  stat_date           date not null,
  level               text not null check (level in ('adgroup', 'keyword')),
  ncc_id              text not null,
  impressions         bigint not null default 0,
  clicks              bigint not null default 0,
  ctr                 numeric(9, 4),
  cpc                 numeric(14, 2),
  cost                numeric(16, 2) not null default 0,
  avg_rank            numeric(6, 2),
  conversions         numeric(14, 2) not null default 0,
  conversion_revenue  numeric(16, 2) not null default 0,
  collected_at        timestamptz not null default now(),
  primary key (client_id, stat_date, ncc_id)
);
create index on public.naver_entity_daily_stats (client_id, level, stat_date);

-- 비즈머니 잔액 (수집할 때마다 갱신)
create table public.naver_account_status (
  client_id    uuid primary key references public.clients (id) on delete cascade,
  bizmoney     bigint,
  budget_lock  boolean,
  checked_at   timestamptz not null default now()
);

-- 채널별 월 예산 (광고비 소진율 계산용)
alter table public.client_ad_channels add column if not exists monthly_budget bigint check (monthly_budget is null or monthly_budget >= 0);

-- 담당자 운영 코멘트 (채널 · 월 단위)
create table public.ad_report_notes (
  client_id   uuid not null references public.clients (id) on delete cascade,
  channel     text not null check (channel in ('naver', 'daangn', 'kakao')),
  period      text not null check (period ~ '^\d{4}-\d{2}$'),
  body        text not null default '' check (length(body) <= 4000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id),
  primary key (client_id, channel, period)
);

do $$
declare t text;
begin
  foreach t in array array['naver_entity_daily_stats', 'naver_account_status', 'ad_report_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.naver_entity_daily_stats, public.naver_account_status to authenticated;
grant select, insert, update, delete on public.ad_report_notes to authenticated;
create policy "담당·관리자 조회" on public.naver_entity_daily_stats for select to authenticated using (public.can_access_client(client_id));
create policy "담당·관리자 조회" on public.naver_account_status   for select to authenticated using (public.can_access_client(client_id));
create policy "담당·관리자 코멘트" on public.ad_report_notes      for all to authenticated using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));

-- 리포트 집계 확장 ---------------------------------------------------------------------------
create or replace function public._naver_report(p_client uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with s as (
    select * from public.naver_daily_stats where client_id = p_client and stat_date between p_from and p_to
  ), prev as (   -- 바로 앞의 같은 길이 기간
    select * from public.naver_daily_stats
     where client_id = p_client and stat_date between p_from - (p_to - p_from + 1) and p_from - 1
  ), e as (
    select * from public.naver_entity_daily_stats where client_id = p_client and stat_date between p_from and p_to
  ), kpi as (
    select coalesce(sum(cost), 0) cost, coalesce(sum(impressions), 0) imp, coalesce(sum(clicks), 0) clk,
           coalesce(sum(conversions), 0) conv, coalesce(sum(conversion_revenue), 0) rev,
           round(sum(avg_rank * impressions) / nullif(sum(impressions), 0), 2) rnk
      from s
  ), pkpi as (
    select coalesce(sum(cost), 0) cost, coalesce(sum(impressions), 0) imp, coalesce(sum(clicks), 0) clk,
           coalesce(sum(conversions), 0) conv, coalesce(sum(conversion_revenue), 0) rev,
           round(sum(avg_rank * impressions) / nullif(sum(impressions), 0), 2) rnk, count(distinct stat_date) days
      from prev
  ), mon as (    -- 조회 종료일이 속한 달의 누적 (1일 ~ 종료일)
    select date_trunc('month', p_to)::date m1, coalesce(sum(cost), 0) spent
      from public.naver_daily_stats where client_id = p_client and stat_date between date_trunc('month', p_to)::date and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'kpi', (select jsonb_build_object('cost', cost, 'impressions', imp, 'clicks', clk,
              'ctr', case when imp > 0 then round(clk::numeric / imp * 100, 2) end,
              'cpc', case when clk > 0 then round(cost / clk, 0) end,
              'conversions', conv, 'revenue', rev, 'avgRank', rnk,
              'roas', case when cost > 0 then round(rev / cost * 100, 1) end) from kpi),
    'prev', (select case when days = 0 then null else jsonb_build_object('cost', cost, 'impressions', imp, 'clicks', clk,
              'ctr', case when imp > 0 then round(clk::numeric / imp * 100, 2) end,
              'cpc', case when clk > 0 then round(cost / clk, 0) end,
              'conversions', conv, 'avgRank', rnk,
              'roas', case when cost > 0 then round(rev / cost * 100, 1) end, 'days', days) end from pkpi),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'cost', cost, 'impressions', imp, 'clicks', clk, 'conversions', conv) order by d)
        from (select stat_date d, sum(cost) cost, sum(impressions) imp, sum(clicks) clk, sum(conversions) conv from s group by stat_date) x), '[]'::jsonb),
    'weekday', coalesce((
      select jsonb_agg(jsonb_build_object('dow', dow, 'days', days, 'cost', cost, 'impressions', imp, 'clicks', clk) order by dow)
        from (select extract(isodow from stat_date)::int dow, count(distinct stat_date) days, sum(cost) cost, sum(impressions) imp, sum(clicks) clk
                from s group by 1) x), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.ncc_campaign_id, 'name', coalesce(nc.name, x.ncc_campaign_id),
               'cost', x.cost, 'impressions', x.imp, 'clicks', x.clk,
               'ctr', case when x.imp > 0 then round(x.clk::numeric / x.imp * 100, 2) end,
               'cpc', case when x.clk > 0 then round(x.cost / x.clk, 0) end,
               'avgRank', x.avg_rank, 'conversions', x.conv,
               'roas', case when x.cost > 0 then round(x.rev / x.cost * 100, 1) end) order by x.cost desc)
        from (select ncc_campaign_id, sum(cost) cost, sum(impressions) imp, sum(clicks) clk, sum(conversions) conv, sum(conversion_revenue) rev,
                     round(sum(avg_rank * impressions) / nullif(sum(impressions), 0), 2) avg_rank
                from s group by ncc_campaign_id) x
        left join public.naver_campaigns nc on nc.client_id = p_client and nc.ncc_id = x.ncc_campaign_id), '[]'::jsonb),
    'adgroups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.ncc_id, 'name', coalesce(nc.name, x.ncc_id), 'campaign', coalesce(cp.name, ''),
               'cost', x.cost, 'impressions', x.imp, 'clicks', x.clk,
               'ctr', case when x.imp > 0 then round(x.clk::numeric / x.imp * 100, 2) end,
               'cpc', case when x.clk > 0 then round(x.cost / x.clk, 0) end,
               'avgRank', x.avg_rank, 'conversions', x.conv) order by x.cost desc, x.imp desc)
        from (select ncc_id, sum(cost) cost, sum(impressions) imp, sum(clicks) clk, sum(conversions) conv,
                     round(sum(avg_rank * impressions) / nullif(sum(impressions), 0), 2) avg_rank
                from e where level = 'adgroup' group by ncc_id) x
        left join public.naver_campaigns nc on nc.client_id = p_client and nc.ncc_id = x.ncc_id
        left join public.naver_campaigns cp on cp.client_id = p_client and cp.ncc_id = nc.parent_ncc_id), '[]'::jsonb),
    'keywords', coalesce((
      select jsonb_agg(k order by (k->>'cost')::numeric desc, (k->>'impressions')::numeric desc) from (
        select jsonb_build_object(
               'id', x.ncc_id, 'keyword', coalesce(nc.name, x.ncc_id), 'adgroup', coalesce(ag.name, ''), 'bid', nc.bid_amt, 'status', nc.status,
               'cost', x.cost, 'impressions', x.imp, 'clicks', x.clk,
               'ctr', case when x.imp > 0 then round(x.clk::numeric / x.imp * 100, 2) end,
               'cpc', case when x.clk > 0 then round(x.cost / x.clk, 0) end,
               'avgRank', x.avg_rank, 'conversions', x.conv) k
          from (select ncc_id, sum(cost) cost, sum(impressions) imp, sum(clicks) clk, sum(conversions) conv,
                       round(sum(avg_rank * impressions) / nullif(sum(impressions), 0), 2) avg_rank
                  from e where level = 'keyword' group by ncc_id having sum(impressions) > 0 or sum(cost) > 0) x
          left join public.naver_campaigns nc on nc.client_id = p_client and nc.ncc_id = x.ncc_id
          left join public.naver_campaigns ag on ag.client_id = p_client and ag.ncc_id = nc.parent_ncc_id
         order by x.cost desc, x.imp desc limit 200) t), '[]'::jsonb),
    'month', (select jsonb_build_object(
                'month', to_char(m1, 'YYYY-MM'), 'spent', spent,
                'elapsedDays', (p_to - m1) + 1,
                'daysInMonth', extract(day from (m1 + interval '1 month - 1 day'))::int,
                'budget', (select monthly_budget from public.client_ad_channels where client_id = p_client and channel = 'naver')) from mon),
    'recentDailyAvg', (select round(avg(c), 0) from (select sum(cost) c from public.naver_daily_stats
                         where client_id = p_client and stat_date between p_to - 6 and p_to group by stat_date) z),
    'bizmoney', (select jsonb_build_object('amount', bizmoney, 'budgetLock', budget_lock, 'checkedAt', checked_at)
                   from public.naver_account_status where client_id = p_client),
    'note', (select jsonb_build_object('body', body, 'updatedAt', updated_at) from public.ad_report_notes
              where client_id = p_client and channel = 'naver' and period = to_char(p_to, 'YYYY-MM')),
    'lastCollectedAt', (select max(collected_at) from public.naver_daily_stats where client_id = p_client)
  );
$$;
revoke execute on function public._naver_report(uuid, date, date) from public, anon, authenticated;
