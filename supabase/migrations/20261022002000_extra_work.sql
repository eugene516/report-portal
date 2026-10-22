-- 견적 외 추가 진행 업무 + 당근마켓 바이럴 자료 구분
-- - client_contract_items.extra: 견적서 확정 내용과 별개로 중간에 추가된 업무 (note: 추가 사유·요청 내용)
-- - add_extra_work: 리포트 각 메뉴에서 "추가 계약"을 바로 등록 (그달 계약이 없으면 빈 계약을 먼저 만든다)
-- - cafe_posts.channel: 카페(cafe) / 당근마켓 바이럴(daangn). 진행 수량은 각각 자동 집계
-- - 이번 달 항목이 바뀌면 리포트 계약 항목(client_services) 월 목표를 같은 합계로 맞춘다 (_sync_services)

alter table public.client_contract_items
  add column if not exists extra boolean not null default false,
  add column if not exists note text check (note is null or length(note) <= 300);

alter table public.cafe_posts
  add column if not exists channel text not null default 'cafe' check (channel in ('cafe', 'daangn'));
create index if not exists cafe_posts_client_period_channel on public.cafe_posts (client_id, period, channel);

-- 자동 집계: 카페와 당근 바이럴을 나눈다
create or replace function public._contract_auto_done(p_client uuid, p_period text, p_service text)
returns int language sql stable security definer set search_path = ''
as $$
  select (case p_service
    when 'blog'     then (select count(*) from public.blog_posts      where client_id = p_client and period = p_period)
    when 'cafe'     then (select count(*) from public.cafe_posts      where client_id = p_client and period = p_period and channel = 'cafe' and status <> '삭제됨')
    when 'daangn'   then (select count(*) from public.cafe_posts      where client_id = p_client and period = p_period and channel = 'daangn' and status <> '삭제됨')
    when 'cardnews' then (select count(*) from public.cardnews_rounds where client_id = p_client and period = p_period)
    when 'column'   then (select count(*) from public.web_columns     where client_id = p_client and period = p_period)
    when 'aeo'      then (select count(distinct keyword) from public.aeo_checks where client_id = p_client and period = p_period)
  end)::int;
$$;
revoke execute on function public._contract_auto_done(uuid, text, text) from public, anon, authenticated;

-- 같은 업무가 견적 항목과 추가 항목으로 나뉘어 있으면 자동 집계 수량은 견적 항목부터 채운다
create or replace function public._contract_items(p_client uuid, p_period text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when exists (select 1 from public.client_month_contracts m where m.client_id = p_client and m.period = p_period) then
    coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'service', x.service, 'label', x.label, 'quantity', x.quantity, 'dueOn', x.due_on,
        'extra', x.extra, 'note', x.note, 'auto', x.n is not null,
        'done', case when x.n is null then coalesce(x.done_count, 0)
                     else greatest(0, least(x.quantity, x.n - x.before)) end) order by x.due_on, x.sort)
      from (select i.*, a.n,
                   coalesce(sum(i.quantity) over (partition by i.service order by i.extra, i.due_on, i.sort rows between unbounded preceding and 1 preceding), 0) as before
              from public.client_contract_items i
              cross join lateral (select public._contract_auto_done(p_client, p_period, i.service) as n) a
             where i.client_id = p_client and i.period = p_period) x), '[]'::jsonb)
  else
    coalesce((select jsonb_agg(jsonb_build_object(
        'id', null, 'service', s.service, 'label', null, 'quantity', s.monthly_target,
        'dueOn', (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date,
        'extra', false, 'note', null, 'auto', a.n is not null, 'done', coalesce(a.n, 0), 'fallback', true) order by s.service)
      from public.client_services s
      cross join lateral (select public._contract_auto_done(p_client, p_period, s.service) as n) a
      where s.client_id = p_client and coalesce(s.monthly_target, 0) > 0), '[]'::jsonb)
  end;
$$;
revoke execute on function public._contract_items(uuid, text) from public, anon, authenticated;

-- 이번 달이면 리포트 계약 항목의 월 목표를 그달 항목 합계로 맞춘다 (기존 항목은 지우지 않는다)
create or replace function public._sync_services(p_client uuid, p_period text)
returns void language sql volatile security definer set search_path = ''
as $$
  insert into public.client_services (client_id, service, monthly_target, updated_at)
  select p_client, service, sum(quantity), now() from public.client_contract_items
   where client_id = p_client and period = p_period and service <> 'etc'
     and p_period = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')
   group by service
  on conflict (client_id, service) do update set monthly_target = excluded.monthly_target, updated_at = now();
$$;
revoke execute on function public._sync_services(uuid, text) from public, anon, authenticated;

create or replace function public.save_month_contract(
  p_client uuid, p_period text, p_amount bigint, p_starts date, p_ends date, p_memo text, p_items jsonb)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare e jsonb; v_id uuid; v_keep uuid[] := '{}'; v_sort int := 0; v_label text; v_note text; v_extra boolean;
begin
  if not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid period' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then raise exception 'invalid items' using errcode = '22023'; end if;

  insert into public.client_month_contracts (client_id, period, amount, starts_on, ends_on, memo, updated_at, updated_by)
  values (p_client, p_period, p_amount, p_starts, p_ends, nullif(btrim(p_memo), ''), now(), auth.uid())
  on conflict (client_id, period) do update
    set amount = excluded.amount, starts_on = excluded.starts_on, ends_on = excluded.ends_on,
        memo = excluded.memo, updated_at = now(), updated_by = auth.uid();

  for e in select * from jsonb_array_elements(p_items) loop
    v_sort := v_sort + 1;
    v_label := nullif(btrim(e->>'label'), '');
    v_note := nullif(btrim(e->>'note'), '');
    v_extra := coalesce((e->>'extra')::boolean, false);
    if e->>'service' = 'etc' and v_label is null then raise exception 'label required' using errcode = '22023'; end if;
    v_id := null;
    if coalesce(e->>'id', '') ~ '^[0-9a-f-]{36}$' then
      update public.client_contract_items
         set service = e->>'service', label = v_label, quantity = (e->>'quantity')::int, due_on = (e->>'dueOn')::date,
             sort = v_sort, extra = v_extra, note = v_note
       where id = (e->>'id')::uuid and client_id = p_client and period = p_period
      returning id into v_id;
    end if;
    if v_id is null then
      insert into public.client_contract_items (client_id, period, service, label, quantity, due_on, sort, extra, note)
      values (p_client, p_period, e->>'service', v_label, (e->>'quantity')::int, (e->>'dueOn')::date, v_sort, v_extra, v_note)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  delete from public.client_contract_items where client_id = p_client and period = p_period and not (id = any (v_keep));
  perform public._sync_services(p_client, p_period);
end;
$$;

-- 리포트 메뉴에서 바로 등록하는 추가 진행 업무 (미집행 항목을 중간에 계약한 경우 포함)
create or replace function public.add_extra_work(
  p_client uuid, p_period text, p_service text, p_label text, p_quantity int, p_due date, p_note text)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid period' using errcode = '22023'; end if;
  if p_service = 'etc' and nullif(btrim(p_label), '') is null then raise exception 'label required' using errcode = '22023'; end if;
  insert into public.client_month_contracts (client_id, period, updated_at, updated_by)
  values (p_client, p_period, now(), auth.uid())
  on conflict (client_id, period) do nothing;
  insert into public.client_contract_items (client_id, period, service, label, quantity, due_on, sort, extra, note)
  values (p_client, p_period, p_service, nullif(btrim(p_label), ''), p_quantity, p_due,
          (select coalesce(max(sort), 0) + 1 from public.client_contract_items where client_id = p_client and period = p_period),
          true, nullif(btrim(p_note), ''))
  returning id into v_id;
  perform public._sync_services(p_client, p_period);
  return v_id;
end;
$$;
revoke execute on function public.add_extra_work(uuid, text, text, text, int, date, text) from public, anon;
grant  execute on function public.add_extra_work(uuid, text, text, text, int, date, text) to authenticated;

-- 지난 레포트 목록: 당근 바이럴을 따로 센다
create or replace function public._report_history(p_client uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'period', p,
      'blog',     (select count(*) from public.blog_posts      where client_id = p_client and period = p),
      'cafe',     (select count(*) from public.cafe_posts      where client_id = p_client and period = p and channel = 'cafe'),
      'daangn',   (select count(*) from public.cafe_posts      where client_id = p_client and period = p and channel = 'daangn'),
      'cardnews', (select count(*) from public.cardnews_rounds where client_id = p_client and period = p),
      'column',   (select count(*) from public.web_columns     where client_id = p_client and period = p),
      'adCost',   (select sum(cost) from public.naver_daily_stats where client_id = p_client and to_char(stat_date, 'YYYY-MM') = p)
    ) order by p desc), '[]'::jsonb)
  from (
    select period p from public.blog_posts where client_id = p_client union
    select period from public.cafe_posts where client_id = p_client union
    select period from public.cardnews_rounds where client_id = p_client union
    select period from public.web_columns where client_id = p_client union
    select distinct to_char(stat_date, 'YYYY-MM') from public.naver_daily_stats where client_id = p_client
  ) x;
$$;
revoke execute on function public._report_history(uuid) from public, anon, authenticated;

-- 리포트 내용: 카페 글에 channel 추가 (나머지는 20261021000900 과 같음)
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

-- 월별 달성률도 항목 목록(_contract_items)과 같은 방식으로 센다 (같은 업무가 견적·추가로 나뉘어도 중복 집계하지 않음)
create or replace function public.month_client_detail(p_client uuid, p_period text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_from date; v_to date;
begin
  if not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid period' using errcode = '22023'; end if;
  v_from := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_to := (v_from + interval '1 month - 1 day')::date;
  return jsonb_build_object(
    'adDaily', coalesce((select jsonb_agg(jsonb_build_object('date', d.stat_date, 'cost', d.cost) order by d.stat_date)
        from (select stat_date, sum(cost) cost from public.naver_daily_stats where client_id = p_client and stat_date between v_from and v_to group by stat_date) d), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('period', h.period, 'quantity', h.q, 'done', h.d) order by h.period)
        from (select m.period,
                     coalesce(sum((e->>'quantity')::int), 0) q,
                     coalesce(sum(least((e->>'quantity')::int, (e->>'done')::int)), 0) d
                from public.client_month_contracts m
                left join lateral jsonb_array_elements(public._contract_items(p_client, m.period)) e on true
               where m.client_id = p_client and m.period <= p_period
                 and m.period > to_char(v_from - interval '6 months', 'YYYY-MM')
               group by m.period) h), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'path', q.storage_path, 'name', q.file_name, 'kind', q.kind, 'at', q.created_at) order by q.created_at desc)
        from public.client_quotes q where q.client_id = p_client and q.period = p_period), '[]'::jsonb)
  );
end;
$$;
