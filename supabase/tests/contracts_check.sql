-- 월별 계약(save_month_contract · month_overview · 지난 레포트) 점검 (원격 DB에서 실행해도 데이터가 남지 않음)
-- 실행: npx supabase db query --linked -f supabase/tests/contracts_check.sql
do $$
declare
  r text := '';
  a uuid; b uuid; item uuid; v jsonb;
  s1 uuid := '00000000-0000-4000-8000-0000000000d1';     -- 직원1 (광고주 a 담당)
  s2 uuid := '00000000-0000-4000-8000-0000000000d2';     -- 직원2 (담당 없음)
  cur text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  n int;
begin
  insert into auth.users (id, email, aud, role) values
    (s1, 'd1-test@example.com', 'authenticated', 'authenticated'), (s2, 'd2-test@example.com', 'authenticated', 'authenticated');
  insert into public.staff_roles (user_id, email, role) values (s1, 'd1-test@example.com', 'staff'), (s2, 'd2-test@example.com', 'staff');
  insert into public.clients (slug, name) values ('zz-contract-a-' || substr(md5(random()::text), 1, 6), '계약시험A') returning id into a;
  insert into public.clients (slug, name) values ('zz-contract-b-' || substr(md5(random()::text), 1, 6), '계약시험B') returning id into b;
  insert into public.client_staff (client_id, user_id, is_primary) values (a, s1, true);
  insert into public.client_services (client_id, service, monthly_target) values (b, 'blog', 4);
  insert into public.blog_posts (client_id, period, keyword, title, url) values (a, cur, 'k', 't', 'https://example.com/1'), (a, cur, 'k2', 't2', 'https://example.com/2');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);

  -- 1. 담당 광고주 계약 저장 + 자동 집계(블로그 2건)
  perform public.save_month_contract(a, cur, 1500000, null, null, '메모',
    jsonb_build_array(jsonb_build_object('service', 'blog', 'quantity', 8, 'dueOn', cur || '-25'),
                      jsonb_build_object('service', 'review', 'quantity', 10, 'dueOn', cur || '-20')));
  v := public.month_overview(cur, a);
  r := r || '1 ' || case when jsonb_array_length(v->0->'items') = 2 and (v->0->'items'->1->>'done')::int = 2 and (v->0->'items'->1->>'auto')::boolean
                         then 'OK' else 'FAIL:' || coalesce(v::text, 'null') end || ';';

  -- 2. 수동 항목 진행 입력 (done_count 만 수정 가능)
  select id into item from public.client_contract_items where client_id = a and service = 'review';
  update public.client_contract_items set done_count = 3 where id = item;
  begin update public.client_contract_items set quantity = 99 where id = item; r := r || '2 FAIL;';
  exception when insufficient_privilege then r := r || '2 OK;'; end;

  -- 3. 다시 저장해도 같은 id 항목의 진행 수량 유지, 빠진 항목은 삭제
  perform public.save_month_contract(a, cur, 1500000, null, null, null,
    jsonb_build_array(jsonb_build_object('id', item, 'service', 'review', 'quantity', 12, 'dueOn', cur || '-21')));
  select count(*) into n from public.client_contract_items where client_id = a and period = cur;
  r := r || '3 ' || case when n = 1 and (select done_count from public.client_contract_items where id = item) = 3 then 'OK' else 'FAIL:' || n end || ';';

  -- 4. 이번 달 계약 → 리포트 월 목표 반영
  r := r || '4 ' || case when (select monthly_target from public.client_services where client_id = a and service = 'review') = 12 then 'OK' else 'FAIL' end || ';';

  -- 5. 담당이 아닌 광고주: 저장·조회 거부, 목록에 안 보임
  begin perform public.save_month_contract(b, cur, null, null, null, null, '[]'); r := r || '5 FAIL;';
  exception when insufficient_privilege then r := r || '5 OK;'; end;
  begin perform public.month_overview(cur, b); r := r || '6 FAIL;';
  exception when insufficient_privilege then r := r || '6 OK;'; end;
  v := public.month_overview(cur);
  r := r || '7 ' || case when not exists (select 1 from jsonb_array_elements(v) e where (e->>'id')::uuid = b) then 'OK' else 'FAIL' end || ';';
  select count(*) into n from public.client_month_contracts where client_id = b;
  r := r || '8 ' || case when n = 0 then 'OK' else 'FAIL' end || ';';

  -- 9. 다른 광고주의 항목 id 를 넣어도 그 항목은 바뀌지 않는다 (직원2가 광고주 b 담당으로 시도 → b 항목 id 위조)
  perform set_config('role', 'postgres', true);
  insert into public.client_month_contracts (client_id, period) values (b, cur);
  insert into public.client_contract_items (client_id, period, service, quantity, due_on) values (b, cur, 'blog', 4, (cur || '-28')::date) returning id into item;
  perform set_config('role', 'authenticated', true);
  perform public.save_month_contract(a, cur, null, null, null, null,
    jsonb_build_array(jsonb_build_object('id', item, 'service', 'blog', 'quantity', 999, 'dueOn', cur || '-10')));
  perform set_config('role', 'postgres', true);
  r := r || '9 ' || case when (select quantity from public.client_contract_items where id = item) = 4 then 'OK' else 'FAIL' end || ';';
  perform set_config('role', 'authenticated', true);

  -- 10. 계약 미등록 광고주는 리포트 월 목표로 대신 표시 (관리자 대신 b 담당 직원2로 확인)
  perform set_config('role', 'postgres', true);
  delete from public.client_month_contracts where client_id = b;
  insert into public.client_staff (client_id, user_id, is_primary) values (b, s2, true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated')::text, true);
  v := public.month_overview(cur, b);
  r := r || '10 ' || case when v->0->'contract' = 'null'::jsonb and (v->0->'items'->0->>'fallback')::boolean and (v->0->'items'->0->>'quantity')::int = 4 then 'OK' else 'FAIL:' || v::text end || ';';

  -- 11. 기타 항목은 이름 필수
  begin perform public.save_month_contract(b, cur, null, null, null, null, jsonb_build_array(jsonb_build_object('service', 'etc', 'quantity', 1, 'dueOn', cur || '-10')));
    r := r || '11 FAIL;';
  exception when invalid_parameter_value then r := r || '11 OK;'; end;

  -- 12. 지난 레포트 목록 (담당 광고주만)
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  v := public.staff_report_history(a);
  r := r || '12 ' || case when (v->0->>'blog')::int = 2 then 'OK' else 'FAIL:' || v::text end || ';';
  begin perform public.staff_report_history(b); r := r || '13 FAIL;';
  exception when insufficient_privilege then r := r || '13 OK;'; end;

  -- 15. 추가 진행 업무: 같은 업무가 견적·추가로 나뉘면 자동 집계(블로그 2건)는 견적 항목부터 채운다
  perform public.add_extra_work(a, cur, 'blog', null, 3, (cur || '-28')::date, '중간 추가 요청');
  v := public.month_overview(cur, a);
  r := r || '15 ' || case when (select sum((e->>'done')::int) from jsonb_array_elements(v->0->'items') e where e->>'service' = 'blog') = 2
                          and exists (select 1 from jsonb_array_elements(v->0->'items') e where (e->>'extra')::boolean and e->>'note' = '중간 추가 요청' and (e->>'done')::int = 0)
                     then 'OK' else 'FAIL:' || (v->0->'items')::text end || ';';
  -- 16. 리포트 월 목표 = 견적 + 추가 합계
  r := r || '16 ' || case when (select monthly_target from public.client_services where client_id = a and service = 'blog') = 1002 then 'OK' else 'FAIL' end || ';';
  -- 17. 당근 바이럴은 카페와 따로 집계
  perform set_config('role', 'postgres', true);
  insert into public.cafe_posts (client_id, period, cafe_name, url, channel) values (a, cur, '당근', 'https://example.com/d', 'daangn'), (a, cur, '카페', 'https://example.com/c', 'cafe');
  perform set_config('role', 'authenticated', true);
  perform public.add_extra_work(a, cur, 'daangn', null, 2, (cur || '-28')::date, null);
  v := public.month_overview(cur, a);
  r := r || '17 ' || case when (select (e->>'done')::int from jsonb_array_elements(v->0->'items') e where e->>'service' = 'daangn') = 1 then 'OK' else 'FAIL' end || ';';
  -- 18. 담당이 아닌 광고주에는 추가 업무를 넣을 수 없다
  begin perform public.add_extra_work(b, cur, 'blog', null, 1, (cur || '-28')::date, null); r := r || '18 FAIL;';
  exception when insufficient_privilege then r := r || '18 OK;'; end;

  -- 14. 로그인하지 않은 요청
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin perform public.month_overview(cur); r := r || '14 FAIL;';
  exception when insufficient_privilege then r := r || '14 OK;'; end;

  raise exception 'RESULT %', r;   -- 결과 출력 + 전부 되돌림
end $$;
