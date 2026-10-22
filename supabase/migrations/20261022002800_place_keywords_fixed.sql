-- 플레이스 키워드 고정 · 중점 키워드 · 월별 리포트는 그달 수집 결과로
-- - tracked_keywords.important: 중점 키워드(리포트에서 맨 앞 · "중점" 표시)
-- - _report_content: 순위는 그달 말일까지 수집한 결과 중 최신 → 지난 레포트는 그달 기준, 이번 달은 최신
-- - 서울청명안과: 10월 엑셀 리포트 '네이버 지도 노출표' 24개 키워드로 고정 (답십리 3개 중점), 목록에 없는 키워드는 숨김(기록은 보존)

alter table public.tracked_keywords add column if not exists important boolean not null default false;

with c as (select id from public.clients where name = '서울청명안과'),
kw(keyword, sort, important) as (values
  ('청량리안과', 1, false), ('청량리역안과', 2, false), ('제기동안과', 3, false), ('동대문구안과', 4, false),
  ('청량리역안과추천', 5, false), ('청량리역 안과병원', 6, false), ('제기동역안과', 7, false), ('경동시장 안과', 8, false),
  ('전농동 안과', 9, false), ('회기역 안과', 10, false), ('안암동 안과', 11, false), ('동대문경찰서 안과', 12, false),
  ('왕십리안과', 13, false), ('청량리동안과', 14, false), ('청량리 안과병원', 15, false), ('제기동 안과병원', 16, false),
  ('답십리안과', 17, true), ('답십리역안과', 18, true), ('답십리동안과', 19, true), ('회기동안과', 20, false),
  ('마장동안과', 21, false), ('마장역안과', 22, false), ('청계천안과', 23, false), ('용답동안과', 24, false))
insert into public.tracked_keywords (client_id, kind, keyword, sort, important, active)
select c.id, 'place', kw.keyword, kw.sort, kw.important, true from c, kw
on conflict (client_id, kind, keyword) do update set sort = excluded.sort, important = excluded.important, active = true;

update public.tracked_keywords t set active = false
  from public.clients c
 where c.id = t.client_id and c.name = '서울청명안과' and t.kind = 'place'
   and t.keyword not in ('청량리안과','청량리역안과','제기동안과','동대문구안과','청량리역안과추천','청량리역 안과병원','제기동역안과','경동시장 안과',
                         '전농동 안과','회기역 안과','안암동 안과','동대문경찰서 안과','왕십리안과','청량리동안과','청량리 안과병원','제기동 안과병원',
                         '답십리안과','답십리역안과','답십리동안과','회기동안과','마장동안과','마장역안과','청계천안과','용답동안과');

-- 리포트 내용 (20261022002000 과 같고, 순위 기간 제한 · important 추가)
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
        'place', case when k.kind = 'place' then (select jsonb_build_object('rank', r.rank, 'adRank', r.ad_rank, 'capture', r.capture_path, 'at', r.collected_at)
                   from public.place_rank_results r where r.client_id = p_client and r.keyword = k.keyword
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
