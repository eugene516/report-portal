-- 리포트 내용 · 계약 항목 · 견적서 · 비공개 파일 저장소
-- 서울청명안과 샘플 페이지의 형식을 그대로 담는다:
--   블로그(원고 + 네이버 메인/블로그 탭 순위), 플레이스(순위 + 캡쳐), 카페(링크 + 캡쳐),
--   SNS 카드뉴스(회차별 채널 링크), 홈페이지 칼럼, AEO, (온라인 광고는 client_ad_channels / naver_*)
-- 모든 행은 client_id 를 가지며, 접근은 can_access_client(client_id) 로 판단한다.
-- period: 보고 월 'YYYY-MM'

-- 계약 항목 (견적서 기준으로 직원이 선택) ------------------------------------------------
create table public.client_services (
  client_id       uuid not null references public.clients (id) on delete cascade,
  service         text not null check (service in ('blog', 'place', 'cafe', 'daangn', 'review', 'cardnews', 'column', 'aeo')),
  monthly_target  int check (monthly_target is null or monthly_target >= 0),
  note            text,
  updated_at      timestamptz not null default now(),
  primary key (client_id, service)
);

-- 견적서 (파일은 비공개 저장소 quotes/{client_id}/...) -------------------------------------
create table public.client_quotes (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid references auth.users (id),
  created_at    timestamptz not null default now()
);

-- 블로그 ---------------------------------------------------------------------------------
create table public.blog_posts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  period        text not null check (period ~ '^\d{4}-\d{2}$'),
  keyword       text not null,
  title         text not null,
  url           text not null check (url ~ '^https?://'),
  post_type     text not null default '일반',
  published_on  date,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id)
);
create index on public.blog_posts (client_id, period);

-- 순위·노출 추적 키워드 (추가 노출 / 플레이스 / AEO / 기타 노출) ---------------------------------
create table public.tracked_keywords (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  kind        text not null check (kind in ('blog_extra', 'place', 'aeo', 'etc')),
  keyword     text not null,
  sort        int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (client_id, kind, keyword)
);

-- 수집 결과 업로드 이력 (ego-browser 수집 → 직원 화면 업로드) ---------------------------------
create table public.data_uploads (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  kind         text not null check (kind in ('blog_rank', 'place_rank', 'cafe_capture', 'content')),
  item_count   int not null default 0,
  note         text,
  uploaded_by  uuid references auth.users (id),
  created_at   timestamptz not null default now()
);

-- 블로그 순위 (회차마다 한 줄, 화면은 키워드별 최신값) -----------------------------------------
create table public.blog_rank_results (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id) on delete cascade,
  keyword        text not null,
  post_url       text,
  main_rank      int check (main_rank is null or main_rank > 0),      -- 네이버 메인(통합검색), 순위 밖 = null
  blog_tab_rank  int check (blog_tab_rank is null or blog_tab_rank > 0),  -- 블로그 탭, 순위 밖 = null
  main_other     jsonb,      -- 해당 원고가 순위 밖일 때 같은 블로그의 다른 글 {rank, url}
  tab_other      jsonb,
  collected_at   timestamptz not null,
  method         text not null default 'ego-browser',
  upload_id      uuid references public.data_uploads (id) on delete set null
);
create index on public.blog_rank_results (client_id, keyword, collected_at desc);

-- 플레이스 순위 + 캡쳐 (캡쳐 파일: captures/{client_id}/...) ---------------------------------
create table public.place_rank_results (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  keyword       text not null,
  rank          int check (rank is null or rank > 0),       -- 광고 제외 순위, 순위 밖 = null
  ad_rank       int check (ad_rank is null or ad_rank > 0),  -- 광고 자리 노출 순서
  capture_path  text,
  collected_at  timestamptz not null,
  method        text not null default 'ego-browser',
  upload_id     uuid references public.data_uploads (id) on delete set null
);
create index on public.place_rank_results (client_id, keyword, collected_at desc);

-- 카페 바이럴 ------------------------------------------------------------------------------
create table public.cafe_posts (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,
  period            text not null check (period ~ '^\d{4}-\d{2}$'),
  posted_on         date,
  cafe_name         text not null,
  url               text not null check (url ~ '^https?://'),
  title             text,
  views             int,
  comments          int,
  stats_basis       text,              -- 조회·댓글 기준 시각 (리포트 기재값)
  status            text not null default '게시중' check (status in ('게시중', '삭제됨')),
  note              text,
  capture_path      text,
  capture_source    text check (capture_source in ('live', 'report')),   -- live = 직접 캡쳐, report = 리포트 당시 캡쳐
  captured_at       timestamptz,
  current_views     int,
  current_comments  int,
  sort              int not null default 0,
  created_at        timestamptz not null default now()
);
create index on public.cafe_posts (client_id, period);

-- SNS 카드뉴스 -----------------------------------------------------------------------------
create table public.cardnews_rounds (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  period      text not null check (period ~ '^\d{4}-\d{2}$'),
  round_no    int not null,
  posted_on   date,
  topic       text,
  created_at  timestamptz not null default now(),
  unique (client_id, period, round_no)
);
create table public.cardnews_links (
  id        uuid primary key default gen_random_uuid(),
  round_id  uuid not null references public.cardnews_rounds (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  media     text not null,     -- 인스타그램 / 당근마켓 / 카카오채널 / 기타
  url       text not null check (url ~ '^https?://')
);

-- 홈페이지 칼럼 · AEO ------------------------------------------------------------------------
create table public.web_columns (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  period        text not null check (period ~ '^\d{4}-\d{2}$'),
  title         text not null,
  url           text not null check (url ~ '^https?://'),
  published_on  date,
  sort          int not null default 0
);
create table public.aeo_checks (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  period      text not null check (period ~ '^\d{4}-\d{2}$'),
  keyword     text not null,
  source      text,
  mentioned   boolean,
  checked_at  timestamptz
);

-- 권한 --------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['client_services','client_quotes','blog_posts','tracked_keywords','data_uploads','blog_rank_results',
                           'place_rank_results','cafe_posts','cardnews_rounds','cardnews_links','web_columns','aeo_checks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
    execute format('create policy "담당·관리자 접근" on public.%I for all to authenticated using (public.can_access_client(client_id)) with check (public.can_access_client(client_id))', t);
  end loop;
end $$;

-- 비공개 파일 저장소: captures(캡쳐), quotes(견적서) — 경로 첫 폴더 = client_id -------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('captures', 'captures', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('quotes',   'quotes',   false, 20971520, array['application/pdf', 'image/png', 'image/jpeg',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/x-hwp', 'application/haansofthwp'])
on conflict (id) do nothing;

create or replace function public.storage_client_of(p_name text)
returns uuid language sql immutable set search_path = ''
as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end;
$$;

create policy "담당·관리자 파일 조회" on storage.objects for select to authenticated
  using (bucket_id in ('captures', 'quotes') and public.can_access_client(public.storage_client_of(name)));
create policy "담당·관리자 파일 업로드" on storage.objects for insert to authenticated
  with check (bucket_id in ('captures', 'quotes') and public.can_access_client(public.storage_client_of(name)));
create policy "담당·관리자 파일 수정" on storage.objects for update to authenticated
  using (bucket_id in ('captures', 'quotes') and public.can_access_client(public.storage_client_of(name)));
create policy "담당·관리자 파일 삭제" on storage.objects for delete to authenticated
  using (bucket_id in ('captures', 'quotes') and public.can_access_client(public.storage_client_of(name)));

-- 리포트 내용 묶음 (화면용) ------------------------------------------------------------------
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
                  order by r.collected_at desc limit 1)) order by b.sort, b.created_at)
        from public.blog_posts b where b.client_id = p_client and b.period = p_period), '[]'::jsonb),
    'keywords', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', k.kind, 'keyword', k.keyword,
        'blogRank', case when k.kind = 'blog_extra' then (select jsonb_build_object('main', r.main_rank, 'blogTab', r.blog_tab_rank, 'at', r.collected_at)
                   from public.blog_rank_results r where r.client_id = p_client and r.keyword = k.keyword order by r.collected_at desc limit 1) end,
        'place', case when k.kind = 'place' then (select jsonb_build_object('rank', r.rank, 'adRank', r.ad_rank, 'capture', r.capture_path, 'at', r.collected_at)
                   from public.place_rank_results r where r.client_id = p_client and r.keyword = k.keyword order by r.collected_at desc limit 1) end
      ) order by k.kind, k.sort, k.keyword) from public.tracked_keywords k where k.client_id = p_client and k.active), '[]'::jsonb),
    'cafe', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'postedOn', c.posted_on, 'cafe', c.cafe_name, 'url', c.url, 'title', c.title, 'views', c.views, 'comments', c.comments,
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

create or replace function public.report_content(p_token text, p_period text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := public.resolve_client_token(p_token);
begin
  if v is null then return null; end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'invalid period' using errcode = '22023'; end if;
  return public._report_content(v, p_period);
end;
$$;

create or replace function public.staff_report_content(p_client uuid, p_period text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'invalid period' using errcode = '22023'; end if;
  return public._report_content(p_client, p_period);
end;
$$;

revoke execute on function public.report_content(text, text)        from public;
revoke execute on function public.staff_report_content(uuid, text)  from public, anon;
grant  execute on function public.report_content(text, text)        to anon, authenticated;
grant  execute on function public.staff_report_content(uuid, text)  to authenticated;
