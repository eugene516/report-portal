-- 견적서 → 계약 자동 반영 · 플레이스 광고 순위 · 플레이스 진행률(오늘 확인한 키워드 비율)
-- 1) apply_quote_contract: 견적서에서 읽은 항목으로 그달 계약을 맞춘다
--    - 견적 항목(추가 업무 제외)을 견적서 내용으로 바꾸고, 같은 업무의 진행 수량(done_count)은 유지
--    - 리포트 계약 항목(client_services): 견적서에 있는 업무 + 플레이스(고정 키워드가 있으면) + 추가 업무만 남긴다
--      → 견적서에 없는 업무(예: 카페 · 당근 바이럴)는 미집행
--    - 온라인 광고 채널: 견적서에 있는 채널은 계약, 없는 채널은 미집행
-- 2) place_rank_results.ad_capture_path: 플레이스 광고 자리 캡쳐(광고 딱지가 붙은 해당 업체 항목에 빨간 박스)
-- 3) month_overview.place.checked: 오늘(한국시간) 순위를 확인한 고정 키워드 수 → 전부 확인하면 100%

create or replace function public._apply_quote_contract(
  p_client uuid, p_period text, p_amount bigint, p_memo text, p_items jsonb, p_channels text[])
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare e jsonb; v_id uuid; v_keep uuid[] := '{}'; v_sort int := 0; v_last date; v_services text[];
begin
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid period' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'invalid items' using errcode = '22023'; end if;
  v_last := (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;

  insert into public.client_month_contracts (client_id, period, amount, starts_on, ends_on, memo, updated_at, updated_by)
  values (p_client, p_period, p_amount, to_date(p_period || '-01', 'YYYY-MM-DD'), v_last, nullif(btrim(p_memo), ''), now(), auth.uid())
  on conflict (client_id, period) do update
    set amount = coalesce(excluded.amount, public.client_month_contracts.amount),
        memo = coalesce(excluded.memo, public.client_month_contracts.memo), updated_at = now(), updated_by = auth.uid();

  for e in select * from jsonb_array_elements(p_items) loop
    v_sort := v_sort + 1;
    -- 같은 업무의 기존 견적 항목이 있으면 수량만 바꾼다(진행 수량 유지)
    update public.client_contract_items set quantity = (e->>'quantity')::int, label = nullif(e->>'label', ''), sort = v_sort
     where id = (select id from public.client_contract_items
                  where client_id = p_client and period = p_period and service = e->>'service' and not extra and not (id = any (v_keep))
                  order by sort limit 1)
    returning id into v_id;
    if v_id is null then
      insert into public.client_contract_items (client_id, period, service, label, quantity, due_on, sort)
      values (p_client, p_period, e->>'service', nullif(e->>'label', ''), (e->>'quantity')::int, v_last, v_sort)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  -- 견적서에 없는 견적 항목은 지운다 (추가 진행 업무는 그대로)
  delete from public.client_contract_items where client_id = p_client and period = p_period and not extra and not (id = any (v_keep));

  -- 이번 달이면 리포트 계약 항목 · 광고 채널도 맞춘다
  if p_period = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM') then
    select array_agg(distinct s) into v_services from (
      select service s from public.client_contract_items where client_id = p_client and period = p_period and service <> 'etc'
      union select 'place' where exists (select 1 from public.tracked_keywords where client_id = p_client and kind = 'place' and active)
    ) x;
    delete from public.client_services where client_id = p_client and not (service = any (coalesce(v_services, '{}')));
    perform public._sync_services(p_client, p_period);
    insert into public.client_services (client_id, service, monthly_target)
    select p_client, s, null from unnest(coalesce(v_services, '{}')) s
    on conflict (client_id, service) do nothing;
    insert into public.client_ad_channels (client_id, channel, contracted)
    select p_client, ch, ch = any (p_channels) from unnest(array['naver', 'daangn', 'kakao']) ch
    on conflict (client_id, channel) do update set contracted = excluded.contracted, updated_at = now();
  end if;
  return jsonb_build_object('items', jsonb_array_length(p_items), 'services', to_jsonb(v_services), 'channels', to_jsonb(p_channels));
end;
$$;
revoke execute on function public._apply_quote_contract(uuid, text, bigint, text, jsonb, text[]) from public, anon, authenticated;

create or replace function public.apply_quote_contract(
  p_client uuid, p_period text, p_amount bigint, p_memo text, p_items jsonb, p_channels text[])
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  return public._apply_quote_contract(p_client, p_period, p_amount, p_memo, p_items, p_channels);
end;
$$;
revoke execute on function public.apply_quote_contract(uuid, text, bigint, text, jsonb, text[]) from public, anon;
grant  execute on function public.apply_quote_contract(uuid, text, bigint, text, jsonb, text[]) to authenticated;

alter table public.place_rank_results add column if not exists ad_capture_path text;
alter table public.client_quotes add column if not exists applied_at timestamptz;
