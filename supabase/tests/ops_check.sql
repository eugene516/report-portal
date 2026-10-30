-- 운영 보완 점검: 계약 마감 자동 할 일 · 반복 업무 · 변경 이력 (원격 DB에서 실행해도 데이터가 남지 않음)
-- 실행: npx supabase db query --linked -f supabase/tests/ops_check.sql
do $$
declare
  r text := '';
  s1 uuid := '00000000-0000-4000-8000-0000000000f1';   -- 직원(주담당)
  ad uuid := '00000000-0000-4000-8000-0000000000f2';   -- 관리자
  a uuid; m uuid; t uuid; n int;
  cur text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  insert into auth.users (id, email, aud, role) values
    (s1, 'f1-test@example.com', 'authenticated', 'authenticated'), (ad, 'f2-test@example.com', 'authenticated', 'authenticated');
  insert into public.staff_roles (user_id, email, role, display_name) values (s1, 'f1-test@example.com', 'staff', '시험직원'), (ad, 'f2-test@example.com', 'admin', '시험관리자');
  insert into public.clients (slug, name) values ('zz-ops-' || substr(md5(random()::text), 1, 6), '운영시험') returning id into a;
  insert into public.client_staff (client_id, user_id, is_primary) values (a, s1, true);
  insert into public.task_members (name, user_id) values ('시험직원', s1) returning id into m;
  insert into public.client_month_contracts (client_id, period) values (a, cur);
  insert into public.client_contract_items (client_id, period, service, quantity, due_on) values
    (a, cur, 'review', 5, today + 2),     -- 3일 이내 → 자동 할 일
    (a, cur, 'place', 3, today + 20);     -- 아직 멀었음

  -- 1. 마감 3일 이내 항목만 주담당 보드에 등록, 두 번 실행해도 1건
  perform public.sync_deadline_tasks();
  perform public.sync_deadline_tasks();
  select count(*) into n from public.todo_cards where assignee_id = m and auto;   -- 20261030004800 부터 할일 카드로 등록
  r := r || '1 ' || case when n = 1 then 'OK' else 'FAIL:' || n end || ';';

  -- 2. 수량을 채우면 자동 할 일도 완료
  update public.client_contract_items set done_count = 5 where client_id = a and service = 'review';
  perform public.sync_deadline_tasks();
  select count(*) into n from public.todo_cards where assignee_id = m and auto and done;
  r := r || '2 ' || case when n = 1 then 'OK' else 'FAIL' end || ';';

  -- 3. 반복 업무: 완료하면 다음 회차(1주 뒤)가 생긴다
  insert into public.team_tasks (member_id, title, due_on, repeat) values (m, '주간 보고', today, 'weekly') returning id into t;
  update public.team_tasks set done = true, done_at = now() where id = t;
  select count(*) into n from public.team_tasks where member_id = m and title = '주간 보고' and not done and due_on = today + 7;
  r := r || '3 ' || case when n = 1 then 'OK' else 'FAIL' end || ';';

  -- 4. 변경 이력: 관리자 세션으로 계약 금액을 바꾸면 기록, 이름도 남는다
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', ad, 'role', 'authenticated')::text, true);
  perform public.save_month_contract(a, cur, 990000, null, null, null,
    (select jsonb_agg(jsonb_build_object('id', id, 'service', service, 'quantity', quantity, 'dueOn', due_on)) from public.client_contract_items where client_id = a));
  select count(*) into n from public.activity_logs where client_id = a and table_name = 'client_month_contracts' and action = '수정' and actor_name = '시험관리자' and changes ? 'amount';
  r := r || '4 ' || case when n >= 1 then 'OK' else 'FAIL' end || ';';

  -- 5. 직원은 변경 이력을 볼 수 없다
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.activity_logs where client_id = a;
  r := r || '5 ' || case when n = 0 then 'OK' else 'FAIL:' || n end || ';';

  -- 6. 링크 토큰 해시는 이력에 남지 않는다
  perform set_config('role', 'postgres', true);
  insert into public.client_access_tokens (client_id, token_hash) values (a, repeat('a', 64));
  select count(*) into n from public.activity_logs where client_id = a and table_name = 'client_access_tokens' and changes ? 'token_hash';
  r := r || '6 ' || case when n = 0 then 'OK' else 'FAIL' end || ';';

  raise exception 'RESULT %', r;
end $$;
