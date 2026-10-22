-- 월별 계약 (매월 새로 맺는 견적·계약 내용) + 운영 대시보드(당월 진행 현황) + 지난 레포트 목록
-- - client_month_contracts: 광고주 × 월 1건 (계약 금액·기간·메모)
-- - client_contract_items : 계약 항목별 수량과 마감일. 진행 수량은 자동 집계(블로그·카페·카드뉴스·칼럼·AEO),
--                           자동 집계가 없는 항목(플레이스·리뷰·당근·기타)은 직원이 직접 입력(done_count)
-- - 저장은 save_month_contract 함수 하나로만 (항목 일괄 교체, 권한·값 검사). 직접 수정은 진행 수량(done_count)만 허용
-- - 이번 달 계약을 저장하면 리포트 계약 항목(client_services)의 월 목표도 같은 수량으로 맞춘다
-- 접근은 다른 표와 같이 can_access_client(client_id) 로 판단한다.

create table public.client_month_contracts (
  client_id   uuid not null references public.clients (id) on delete cascade,
  period      text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount      bigint check (amount is null or amount >= 0),        -- 계약 금액 (원)
  starts_on   date,
  ends_on     date,
  memo        text check (memo is null or length(memo) <= 2000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id),
  primary key (client_id, period),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

create table public.client_contract_items (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null,
  period      text not null,
  service     text not null check (service in ('blog', 'place', 'cafe', 'daangn', 'review', 'cardnews', 'column', 'aeo', 'etc')),
  label       text check (label is null or length(label) between 1 and 60),
  quantity    int not null check (quantity between 0 and 10000),
  done_count  int check (done_count is null or done_count between 0 and 10000),
  due_on      date not null,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  foreign key (client_id, period) references public.client_month_contracts (client_id, period) on delete cascade
);
create index on public.client_contract_items (client_id, period);

-- 견적서·계약서 파일: 어느 달 계약인지와 종류
alter table public.client_quotes
  add column if not exists period text check (period is null or period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  add column if not exists kind text not null default 'quote' check (kind in ('quote', 'contract'));
create index if not exists client_quotes_client_period on public.client_quotes (client_id, period);

alter table public.client_month_contracts enable row level security;
alter table public.client_contract_items  enable row level security;
revoke all on public.client_month_contracts from anon, authenticated;
revoke all on public.client_contract_items  from anon, authenticated;
grant select on public.client_month_contracts to authenticated;
grant select on public.client_contract_items  to authenticated;
grant update (done_count) on public.client_contract_items to authenticated;
grant all on public.client_month_contracts, public.client_contract_items to service_role;
create policy "담당·관리자 조회" on public.client_month_contracts for select to authenticated using (public.can_access_client(client_id));
create policy "담당·관리자 조회" on public.client_contract_items  for select to authenticated using (public.can_access_client(client_id));
create policy "담당·관리자 진행 입력" on public.client_contract_items for update to authenticated
  using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));

-- 자동 집계 진행 수량 (자동 집계가 없는 항목은 null)
create or replace function public._contract_auto_done(p_client uuid, p_period text, p_service text)
returns int language sql stable security definer set search_path = ''
as $$
  select (case p_service
    when 'blog'     then (select count(*) from public.blog_posts      where client_id = p_client and period = p_period)
    when 'cafe'     then (select count(*) from public.cafe_posts      where client_id = p_client and period = p_period and status <> '삭제됨')
    when 'cardnews' then (select count(*) from public.cardnews_rounds where client_id = p_client and period = p_period)
    when 'column'   then (select count(*) from public.web_columns     where client_id = p_client and period = p_period)
    when 'aeo'      then (select count(distinct keyword) from public.aeo_checks where client_id = p_client and period = p_period)
  end)::int;
$$;
revoke execute on function public._contract_auto_done(uuid, text, text) from public, anon, authenticated;

-- 항목 목록 (계약이 없으면 리포트 계약 항목의 월 목표로 대신 보여준다 → fallback: true)
create or replace function public._contract_items(p_client uuid, p_period text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when exists (select 1 from public.client_month_contracts m where m.client_id = p_client and m.period = p_period) then
    coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'service', i.service, 'label', i.label, 'quantity', i.quantity, 'dueOn', i.due_on,
        'auto', a.n is not null, 'done', coalesce(a.n, i.done_count, 0)) order by i.due_on, i.sort)
      from public.client_contract_items i
      cross join lateral (select public._contract_auto_done(p_client, p_period, i.service) as n) a
      where i.client_id = p_client and i.period = p_period), '[]'::jsonb)
  else
    coalesce((select jsonb_agg(jsonb_build_object(
        'id', null, 'service', s.service, 'label', null, 'quantity', s.monthly_target,
        'dueOn', (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date,
        'auto', a.n is not null, 'done', coalesce(a.n, 0), 'fallback', true) order by s.service)
      from public.client_services s
      cross join lateral (select public._contract_auto_done(p_client, p_period, s.service) as n) a
      where s.client_id = p_client and coalesce(s.monthly_target, 0) > 0), '[]'::jsonb)
  end;
$$;
revoke execute on function public._contract_items(uuid, text) from public, anon, authenticated;

-- 운영 대시보드: 호출자가 볼 수 있는 광고주의 당월 계약 진행 현황 (p_client 를 주면 그 광고주만)
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
        coalesce((select jsonb_agg(jsonb_build_object('id', s.user_id, 'name', coalesce(r.display_name, split_part(r.email, '@', 1)), 'primary', s.is_primary) order by s.is_primary desc)
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
        (select count(*) from public.naver_sync_logs l where l.client_id = c.id and l.status = 'failed' and l.started_at > now() - interval '7 days') as sync_failed_7d
      from public.clients c
      where public.can_access_client(c.id) and (p_client is null or c.id = p_client)
    ) x), '[]'::jsonb);
end;
$$;

-- 광고주 진행 상세: 당월 일별 광고비 + 최근 6개월 계약 달성률
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
                     coalesce(sum(i.quantity), 0) q,
                     coalesce(sum(least(i.quantity, coalesce(public._contract_auto_done(p_client, m.period, i.service), i.done_count, 0))), 0) d
                from public.client_month_contracts m
                left join public.client_contract_items i on i.client_id = m.client_id and i.period = m.period
               where m.client_id = p_client and m.period <= p_period
                 and m.period > to_char(v_from - interval '6 months', 'YYYY-MM')
               group by m.period) h), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'path', q.storage_path, 'name', q.file_name, 'kind', q.kind, 'at', q.created_at) order by q.created_at desc)
        from public.client_quotes q where q.client_id = p_client and q.period = p_period), '[]'::jsonb)
  );
end;
$$;

-- 월 계약 저장 (항목 일괄 교체). 같은 id 항목은 직접 입력한 진행 수량을 유지한다.
create or replace function public.save_month_contract(
  p_client uuid, p_period text, p_amount bigint, p_starts date, p_ends date, p_memo text, p_items jsonb)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare e jsonb; v_id uuid; v_keep uuid[] := '{}'; v_sort int := 0; v_label text;
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
    if e->>'service' = 'etc' and v_label is null then raise exception 'label required' using errcode = '22023'; end if;
    v_id := null;
    if coalesce(e->>'id', '') ~ '^[0-9a-f-]{36}$' then
      update public.client_contract_items
         set service = e->>'service', label = v_label, quantity = (e->>'quantity')::int, due_on = (e->>'dueOn')::date, sort = v_sort
       where id = (e->>'id')::uuid and client_id = p_client and period = p_period
      returning id into v_id;
    end if;
    if v_id is null then
      insert into public.client_contract_items (client_id, period, service, label, quantity, due_on, sort)
      values (p_client, p_period, e->>'service', v_label, (e->>'quantity')::int, (e->>'dueOn')::date, v_sort)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  delete from public.client_contract_items where client_id = p_client and period = p_period and not (id = any (v_keep));

  -- 이번 달 계약이면 리포트 계약 항목(메뉴·월 목표)도 맞춘다 (기존 항목은 지우지 않는다)
  if p_period = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM') then
    insert into public.client_services (client_id, service, monthly_target, updated_at)
    select p_client, service, sum(quantity), now() from public.client_contract_items
     where client_id = p_client and period = p_period and service <> 'etc' group by service
    on conflict (client_id, service) do update set monthly_target = excluded.monthly_target, updated_at = now();
  end if;
end;
$$;

-- 지난 레포트 목록: 자료가 있는 달별 요약 (광고주 링크 화면에도 쓰므로 금액·메모는 넣지 않는다)
create or replace function public._report_history(p_client uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'period', p,
      'blog',     (select count(*) from public.blog_posts      where client_id = p_client and period = p),
      'cafe',     (select count(*) from public.cafe_posts      where client_id = p_client and period = p),
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

create or replace function public.report_history(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := public.resolve_client_token(p_token);
begin
  if v is null then return null; end if;
  return public._report_history(v);
end;
$$;

create or replace function public.staff_report_history(p_client uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  return public._report_history(p_client);
end;
$$;

revoke execute on function public.month_overview(text, uuid)       from public, anon;
revoke execute on function public.month_client_detail(uuid, text)  from public, anon;
revoke execute on function public.save_month_contract(uuid, text, bigint, date, date, text, jsonb) from public, anon;
revoke execute on function public.report_history(text)             from public;
revoke execute on function public.staff_report_history(uuid)       from public, anon;
grant  execute on function public.month_overview(text, uuid)       to authenticated;
grant  execute on function public.month_client_detail(uuid, text)  to authenticated;
grant  execute on function public.save_month_contract(uuid, text, bigint, date, date, text, jsonb) to authenticated;
grant  execute on function public.report_history(text)             to anon, authenticated;
grant  execute on function public.staff_report_history(uuid)       to authenticated;
