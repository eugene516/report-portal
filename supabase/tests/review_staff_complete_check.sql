-- 파일 검수 직원 완료 처리 점검 (원격 DB에서 실행해도 데이터가 남지 않음)
-- 실행: npx supabase db query --linked -f supabase/tests/review_staff_complete_check.sql
do $$
declare
  r text := '';
  st uuid := '00000000-0000-4000-8000-0000000000b1';   -- 담당 직원
  ot uuid := '00000000-0000-4000-8000-0000000000b2';   -- 담당 아닌 직원
  ca uuid := '00000000-0000-4000-8000-0000000000b3';   -- 광고주 계정
  a uuid; i1 uuid; i2 uuid; i3 uuid; v jsonb;
  cur text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
begin
  insert into auth.users (id, email, aud, role) values
    (st, 'rb1@example.com', 'authenticated', 'authenticated'), (ot, 'rb2@example.com', 'authenticated', 'authenticated'), (ca, 'rb3@example.com', 'authenticated', 'authenticated');
  insert into public.staff_roles (user_id, email, role) values (st, 'rb1@example.com', 'staff'), (ot, 'rb2@example.com', 'staff');
  insert into public.clients (slug, name) values ('zz-rc-a-' || substr(md5(random()::text), 1, 6), '완료시험A') returning id into a;
  insert into public.client_staff (client_id, user_id, is_primary) values (a, st, true);
  insert into public.client_users (user_id, client_id, email, name) values (ca, a, 'rb3@example.com', 'A원장');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  insert into public.review_items (client_id, kind, period, title, created_by) values (a, 'blog', cur, '이미 확정된 원고', st) returning id into i1;
  insert into public.review_items (client_id, kind, period, title, created_by) values (a, 'blog', cur, '검수 대기 원고', st) returning id into i2;
  insert into public.review_items (client_id, kind, period, title, created_by) values (a, 'blog', cur, '파일 없는 원고', st) returning id into i3;
  insert into public.review_files (item_id, client_id, version, file_name, storage_path) values
    (i1, a, 1, '원고.docx', a || '/' || i1 || '/v1/y1.docx'), (i2, a, 1, '원고.docx', a || '/' || i2 || '/v1/y2.docx');
  perform public.review_request(i2);
  -- 1. 작성 중 콘텐츠 바로 완료 처리
  v := public.review_staff_complete(i1, '광고주와 확정된 원고');
  r := r || '1 ' || case when (select status = 'approved' and approved_version = 1 and requested_at is not null from public.review_items where id = i1) then 'OK' else 'FAIL' end || ';';
  -- 2. 검수 대기 콘텐츠 완료 처리 + 기록(직원)
  perform public.review_staff_complete(i2);
  r := r || '2 ' || case when exists (select 1 from public.review_events where item_id = i2 and action = 'approve' and actor_kind = 'staff') then 'OK' else 'FAIL' end || ';';
  -- 3. 두 번 눌러도 기록은 하나
  perform public.review_staff_complete(i2);
  r := r || '3 ' || case when (select count(*) from public.review_events where item_id = i2 and action = 'approve') = 1 then 'OK' else 'FAIL' end || ';';
  -- 4. 파일 없으면 불가
  begin perform public.review_staff_complete(i3); r := r || '4 FAIL;';
  exception when others then r := r || case when sqlerrm = 'no files' then '4 OK;' else '4 FAIL(' || sqlerrm || ');' end; end;
  -- 5. 담당 아닌 직원은 불가
  perform set_config('request.jwt.claims', json_build_object('sub', ot, 'role', 'authenticated')::text, true);
  begin perform public.review_staff_complete(i3); r := r || '5 FAIL;';
  exception when insufficient_privilege then r := r || '5 OK;'; end;
  -- 6. 광고주 계정은 직원 완료 처리 불가
  perform set_config('request.jwt.claims', json_build_object('sub', ca, 'role', 'authenticated')::text, true);
  begin perform public.review_staff_complete(i3); r := r || '6 FAIL;';
  exception when insufficient_privilege then r := r || '6 OK;'; end;
  -- 7. 비로그인(anon)은 함수 실행 권한 없음
  r := r || '7 ' || case when has_function_privilege('anon', 'public.review_staff_complete(uuid, text)', 'execute') then 'FAIL' else 'OK' end || ';';
  -- 8. 대시보드 요약에 완료로 반영
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  r := r || '8 ' || case when (public.staff_review_summary(a, cur) -> 'kinds' -> 0 ->> 'approved')::int = 2 then 'OK' else 'FAIL' end || ';';
  raise exception 'RESULT %', r;
end $$;
