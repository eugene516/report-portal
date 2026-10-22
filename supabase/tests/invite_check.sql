-- 직원 초대·내 정보 수정 점검 (원격 DB에서 실행해도 데이터가 남지 않음)
-- 실행: npx supabase db query --linked -f supabase/tests/invite_check.sql
do $$
declare
  r text := '';
  s1 uuid := '00000000-0000-4000-8000-0000000000d1';
  s2 uuid := '00000000-0000-4000-8000-0000000000d2';
  v jsonb; n int;
begin
  insert into auth.users (id, email, aud, role) values (s1, 'd1-test@example.com', 'authenticated', 'authenticated'), (s2, 'd2-test@example.com', 'authenticated', 'authenticated');
  insert into public.staff_roles (user_id, email, role, display_name, must_change_password) values (s1, 'd1-test@example.com', 'staff', '시험1', true), (s2, 'd2-test@example.com', 'staff', '시험2', true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);

  perform public.update_my_profile('  새이름  ');
  perform set_config('role', 'postgres', true);
  r := r || '1 ' || case when (select display_name from public.staff_roles where user_id = s1) = '새이름' then 'OK' else 'FAIL' end || ';';
  r := r || '2 ' || case when (select display_name from public.staff_roles where user_id = s2) = '시험2' then 'OK' else 'FAIL' end || ';';   -- 남의 이름은 그대로
  perform set_config('role', 'authenticated', true);
  begin perform public.update_my_profile(''); r := r || '3 FAIL;'; exception when invalid_parameter_value then r := r || '3 OK;'; end;
  perform public.mark_password_changed();
  perform set_config('role', 'postgres', true);
  r := r || '4 ' || case when not (select must_change_password from public.staff_roles where user_id = s1) and (select must_change_password from public.staff_roles where user_id = s2) then 'OK' else 'FAIL' end || ';';
  -- 직원은 본인 플래그를 직접 바꾸거나 남의 정보를 수정할 수 없다 (테이블 직접 수정 차단)
  perform set_config('role', 'authenticated', true);
  begin
    update public.staff_roles set must_change_password = false, role = 'admin' where user_id in (s1, s2);
    get diagnostics n = row_count;
    r := r || '5 ' || case when n = 0 then 'OK' else 'FAIL:' || n end || ';';
  exception when insufficient_privilege then r := r || '5 OK;'; end;
  begin v := public.staff_overview(); r := r || '6 FAIL;'; exception when insufficient_privilege then r := r || '6 OK;'; end;   -- 직원은 직원 현황 못 봄

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin perform public.update_my_profile('x'); r := r || '7 FAIL;'; exception when insufficient_privilege then r := r || '7 OK;'; end;
  raise exception 'RESULT %', r;
end $$;
