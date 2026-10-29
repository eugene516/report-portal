-- 플레이스 광고 전용 키워드(place_ad): 플레이스 순위 표에는 넣지 않고, 매일 점검에서 플레이스 광고 자리 순위만 함께 확인한다
-- 결과는 플레이스 순위와 같은 place_rank_results 에 쌓인다. 광고 자리는 플레이스 5페이지까지 찾고 몇 페이지였는지(ad_page)도 남긴다
alter table public.tracked_keywords drop constraint tracked_keywords_kind_check;
alter table public.tracked_keywords add constraint tracked_keywords_kind_check check (kind in ('blog_extra', 'place', 'place_ad', 'aeo', 'etc'));
alter table public.place_rank_results add column if not exists ad_page int check (ad_page is null or ad_page between 1 and 5);

-- 리포트 내용: place_ad 키워드에도 최신 플레이스 결과(place) 추가, place 에 adPage 추가 (나머지는 20261028004300 과 같음)
create or replace function public._report_content(p_client uuid, p_period text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'period', p_period,
    'periods', coalesce((select jsonb_agg(p order by p desc) from (
        select period p from public.blog_posts where client_id = p_client union
        select period from public.cafe_posts where client_id = p_client union
        select period from public.cardnews_rounds where client_id = p_client union
        select period from public.web_columns where client_id = p_client) x), '[]'::jsonb),
    'services', coalesce((select jsonb_object_agg(service, jsonb_build_object('target', monthly_target)) from public.client_services where client_id = p_client), '{}'::jsonb),
    'blog', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'keyword', b.keyword, 'title', b.title, 'url', b.url, 'type', b.post_type, 'publishedOn', b.published_on,
        'rank', (select jsonb_build_object('main', r.main_rank, 'blogTab', r.blog_tab_rank, 'mainOther', r.main_other, 'tabOther', r.tab_other, 'at', r.collected_at)
                   from public.blog_rank_results r where r.client_id = p_client and r.keyword = b.keyword
                    and r.collected_at < (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month') at time zone 'Asia/Seoul'
                  order by r.collected_at desc limit 1)) order by b.sort, b.created_at)
        from public.blog_posts b where b.client_id = p_client and b.period = p_period), '[]'::jsonb),
    'keywords', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', k.kind, 'keyword', k.keyword, 'important', k.important,
        'blogRank', case when k.kind = 'blog_extra' then (select jsonb_build_object('main', r.main_rank, 'blogTab', r.blog_tab_rank, 'at', r.collected_at)
                   from public.blog_rank_results r where r.client_id = p_client and r.keyword = k.keyword
                    and r.collected_at < (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month') at time zone 'Asia/Seoul' order by r.collected_at desc limit 1) end,
        'place', case when k.kind in ('place', 'place_ad') then (select jsonb_build_object('rank', r.rank, 'adRank', r.ad_rank, 'adPage', r.ad_page, 'page', r.page, 'capture', r.capture_path, 'adCapture', r.ad_capture_path, 'at', r.collected_at)
                   from public.place_rank_results r where r.client_id = p_client and r.keyword = k.keyword
                    and r.collected_at < (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month') at time zone 'Asia/Seoul' order by r.collected_at desc limit 1) end,
        'exposure', case when k.kind in ('aeo', 'etc') then (select jsonb_build_object('homepage', r.homepage_rank, 'aiShown', r.ai_shown, 'aiMention', r.ai_mention, 'powerlink', r.powerlink_rank, 'capture', r.capture_path, 'at', r.collected_at)
                   from public.exposure_results r where r.client_id = p_client and r.keyword = k.keyword
                    and r.collected_at < (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month') at time zone 'Asia/Seoul' order by r.collected_at desc limit 1) end
      ) order by k.kind, k.important desc, k.sort, k.keyword) from public.tracked_keywords k where k.client_id = p_client and k.active), '[]'::jsonb),
    'cafe', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'channel', c.channel, 'postedOn', c.posted_on, 'cafe', c.cafe_name, 'url', c.url, 'title', c.title, 'views', c.views, 'comments', c.comments,
        'basis', c.stats_basis, 'status', c.status, 'note', c.note, 'capture', c.capture_path, 'captureSource', c.capture_source,
        'capturedAt', c.captured_at, 'currentViews', c.current_views, 'currentComments', c.current_comments) order by c.sort, c.posted_on)
        from public.cafe_posts c where c.client_id = p_client and c.period = p_period), '[]'::jsonb),
    'cardnews', coalesce((select jsonb_agg(jsonb_build_object(
        'round', r.round_no, 'postedOn', r.posted_on, 'topic', r.topic,
        'links', coalesce((select jsonb_agg(jsonb_build_object('media', l.media, 'url', l.url)) from public.cardnews_links l where l.round_id = r.id), '[]'::jsonb)) order by r.round_no)
        from public.cardnews_rounds r where r.client_id = p_client and r.period = p_period), '[]'::jsonb),
    'columns', coalesce((select jsonb_agg(jsonb_build_object('title', w.title, 'url', w.url, 'publishedOn', w.published_on) order by w.sort)
        from public.web_columns w where w.client_id = p_client and w.period = p_period), '[]'::jsonb),
    'aeo', coalesce((select jsonb_agg(jsonb_build_object('keyword', a.keyword, 'source', a.source, 'mentioned', a.mentioned))
        from public.aeo_checks a where a.client_id = p_client and a.period = p_period), '[]'::jsonb)
  );
$$;
revoke execute on function public._report_content(uuid, text) from public, anon, authenticated;
