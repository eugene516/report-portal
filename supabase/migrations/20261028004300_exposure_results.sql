-- 기타 노출(기존 '기타' + 'AEO' 키워드 통합): 네이버 통합검색에서 홈페이지 · AI 브리핑 · 파워링크 노출을 매일 확인하고 캡쳐를 남긴다
-- 캡쳐 파일: captures/{client_id}/exposure/{시각}/{번호}.jpg (플레이스 캡쳐와 같은 비공개 저장소 · 같은 열람 규칙)

create table public.exposure_results (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients (id) on delete cascade,
  keyword         text not null,
  homepage_rank   int check (homepage_rank is null or homepage_rank > 0),    -- 통합검색 웹 결과 중 홈페이지 순서, 미노출 = null
  ai_shown        boolean not null default false,                             -- AI 브리핑 영역이 나왔는지
  ai_mention      boolean not null default false,                             -- AI 브리핑에 병원 이름 · 홈페이지가 언급됐는지
  powerlink_rank  int check (powerlink_rank is null or powerlink_rank > 0),  -- 파워링크 광고 중 몇 번째인지, 미노출 = null
  capture_path    text,
  collected_at    timestamptz not null,
  method          text not null default 'ego-browser'
);
create index on public.exposure_results (client_id, keyword, collected_at desc);

alter table public.exposure_results enable row level security;
revoke all on public.exposure_results from anon;
grant select, insert, update, delete on public.exposure_results to authenticated, service_role;
create policy "담당·관리자 접근" on public.exposure_results for all to authenticated
  using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));

-- 리포트 내용: 기타 · AEO 키워드에 최신 노출 확인 결과(exposure) 추가 (나머지는 20261022003400 과 같음)
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
        'place', case when k.kind = 'place' then (select jsonb_build_object('rank', r.rank, 'adRank', r.ad_rank, 'page', r.page, 'capture', r.capture_path, 'adCapture', r.ad_capture_path, 'at', r.collected_at)
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
