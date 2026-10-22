-- 담당 직원 일괄 변경(set_client_staff) 점검 (원격 DB에서 실행해도 데이터가 남지 않음)
-- 실행: npx supabase db query --linked -f supabase/tests/assign_staff_check.sql
do $$
declare
  r text := '';
  a uuid;
  s1 uuid := '00000000-0000-4000-8000-0000000000c1';     -- 직원1 (주담당)
  s2 uuid := '00000000-0000-4000-8000-0000000000c2';     -- 직원2
  ad uuid := '00000000-0000-4000-8000-0000000000c3';     -- 관리자
  n int;
begin
  insert into auth.users (id, email, aud, role) values
    (s1, 'c1-test@example.com', 'authenticated', 'authenticated'), (s2, 'c2-test@example.com', 'authenticated', 'authenticated'),
    (ad, 'c3-test@example.com', 'authenticated', 'authenticated');
  insert into public.staff_roles (user_id, email, role) values (s1, 'c1-test@example.com', 'staff'), (s2, 'c2-test@example.com', 'staff'), (ad, 'c3-test@example.com', 'admin');
  insert into public.clients (slug, name) values ('zz-assign-' || substr(md5(random()::text), 1, 6), '배정시험') returning id into a;
  insert into public.client_staff (client_id, user_id, is_primary) values (a, s1, true);

  perform set_config('role', 'authenticated', true);

  -- 주담당이어도 직원은 이 메뉴 함수를 쓸 수 없다
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  begin perform public.set_client_staff(a, s2, '{}'); r := r || '1 FAIL;';
  exception when insufficient_privilege then r := r || '1 OK;'; end;

  -- 관리자: 주담당 교체 + 보조 지정 (보조 목록에 주담당이 섞여도 무시)
  perform set_config('request.jwt.claims', json_build_object('sub', ad, 'role', 'authenticated')::text, true);
  perform public.set_client_staff(a, s2, array[s1, s2, s1]);
  select count(*) into n from public.client_staff where client_id = a and user_id = s2 and is_primary;
  r := r || '2 ' || case when n = 1 then 'OK' else 'FAIL' end || ';';
  select count(*) into n from public.client_staff where client_id = a and user_id = s1 and not is_primary;
  r := r || '3 ' || case when n = 1 then 'OK' else 'FAIL' end || ';';
  select count(*) into n from public.client_staff where client_id = a;
  r := r || '4 ' || case when n = 2 then 'OK' else 'FAIL:' || n end || ';';

  -- 보조 전부 제외
  perform public.set_client_staff(a, s1, '{}');
  select count(*) into n from public.client_staff where client_id = a;
  r := r || '5 ' || case when n = 1 then 'OK' else 'FAIL:' || n end || ';';

  -- 직원 명단에 없는 계정, 주담당 비우기는 거부되고 기존 배정은 그대로
  begin perform public.set_client_staff(a, '00000000-0000-4000-8000-0000000000ff', '{}'); r := r || '6 FAIL;';
  exception when invalid_parameter_value then r := r || '6 OK;'; end;
  begin perform public.set_client_staff(a, null, array[s2]); r := r || '7 FAIL;';
  exception when invalid_parameter_value then r := r || '7 OK;'; end;
  select count(*) into n from public.client_staff where client_id = a and user_id = s1 and is_primary;
  r := r || '8 ' || case when n = 1 then 'OK' else 'FAIL' end || ';';

  -- 로그인하지 않은 요청
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin perform public.set_client_staff(a, s1, '{}'); r := r || '9 FAIL;';
  exception when insufficient_privilege then r := r || '9 OK;'; end;

  raise exception 'RESULT %', r;   -- 결과 출력 + 전부 되돌림
end $$;
