-- 업무 확인 보드 권한 점검 (원격 DB에서 실행해도 데이터가 남지 않음)
-- 실행: npx supabase db query --linked -f supabase/tests/tasks_check.sql
do $$
declare
  r text := '';
  s1 uuid := '00000000-0000-4000-8000-0000000000e1';     -- 직원
  ad uuid := '00000000-0000-4000-8000-0000000000e2';     -- 관리자
  m uuid; t uuid; n int;
begin
  insert into auth.users (id, email, aud, role) values
    (s1, 'e1-test@example.com', 'authenticated', 'authenticated'), (ad, 'e2-test@example.com', 'authenticated', 'authenticated');
  insert into public.staff_roles (user_id, email, role) values (s1, 'e1-test@example.com', 'staff'), (ad, 'e2-test@example.com', 'admin');

  perform set_config('role', 'authenticated', true);

  -- 1. 관리자: 멤버 추가 가능
  perform set_config('request.jwt.claims', json_build_object('sub', ad, 'role', 'authenticated')::text, true);
  insert into public.task_members (name) values ('시험멤버') returning id into m;
  r := r || '1 OK;';

  -- 2. 직원: 멤버 추가·삭제 불가
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  begin insert into public.task_members (name) values ('몰래'); r := r || '2 FAIL;';
  exception when insufficient_privilege then r := r || '2 OK;'; end;
  delete from public.task_members where id = m;
  select count(*) into n from public.task_members where id = m;
  r := r || '3 ' || case when n = 1 then 'OK' else 'FAIL' end || ';';

  -- 4. 직원: 업무 추가·완료·수정·삭제 가능
  insert into public.team_tasks (member_id, title) values (m, '시험 업무') returning id into t;
  update public.team_tasks set done = true, done_at = now(), title = '시험 업무 수정' where id = t;
  select count(*) into n from public.team_tasks where id = t and done and title = '시험 업무 수정';
  r := r || '4 ' || case when n = 1 then 'OK' else 'FAIL' end || ';';
  delete from public.team_tasks where id = t;
  select count(*) into n from public.team_tasks where id = t;
  r := r || '5 ' || case when n = 0 then 'OK' else 'FAIL' end || ';';

  -- 6. 로그인하지 않은 요청: 조회 불가
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin select count(*) into n from public.team_tasks; r := r || '6 FAIL:' || n || ';';
  exception when insufficient_privilege then r := r || '6 OK;'; end;

  raise exception 'RESULT %', r;   -- 결과 출력 + 전부 되돌림
end $$;
