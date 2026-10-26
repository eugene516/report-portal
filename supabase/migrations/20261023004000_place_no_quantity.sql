-- 플레이스: 계약 수량 없이 고정 등록 키워드로 매일 확인 (견적서에 플레이스 수량이 있어도 계약 항목으로 만들지 않음)
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
    -- 플레이스는 계약 수량 없이 고정 키워드로 매일 확인한다 → 계약 항목으로 만들지 않는다
    continue when e->>'service' = 'place';
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
                                 or p_items @> '[{"service": "place"}]'::jsonb
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
