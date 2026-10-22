-- 파일 검수 점검 (원격 DB에서 실행해도 데이터가 남지 않음)
-- 실행: npx supabase db query --linked -f supabase/tests/review_check.sql
do $$
declare
  r text := '';
  st uuid := '00000000-0000-4000-8000-0000000000a1';   -- 담당 직원
  ca uuid := '00000000-0000-4000-8000-0000000000a2';   -- 광고주 A 계정
  cb uuid := '00000000-0000-4000-8000-0000000000a3';   -- 광고주 B 계정
  a uuid; b uuid; i1 uuid; i2 uuid; i3 uuid; n int; v jsonb;
  cur text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
begin
  insert into auth.users (id, email, aud, role) values
    (st, 'ra1@example.com', 'authenticated', 'authenticated'), (ca, 'ra2@example.com', 'authenticated', 'authenticated'), (cb, 'ra3@example.com', 'authenticated', 'authenticated');
  insert into public.staff_roles (user_id, email, role) values (st, 'ra1@example.com', 'staff');
  insert into public.clients (slug, name) values ('zz-rv-a-' || substr(md5(random()::text), 1, 6), '검수시험A') returning id into a;
  insert into public.clients (slug, name) values ('zz-rv-b-' || substr(md5(random()::text), 1, 6), '검수시험B') returning id into b;
  insert into public.client_staff (client_id, user_id, is_primary) values (a, st, true);
  insert into public.client_users (user_id, client_id, email, name) values (ca, a, 'ra2@example.com', 'A원장'), (cb, b, 'ra3@example.com', 'B원장');
  insert into public.client_month_contracts (client_id, period) values (a, cur);
  insert into public.client_contract_items (client_id, period, service, quantity, due_on) values (a, cur, 'blog', 3, current_date + 10);

  perform set_config('role', 'authenticated', true);
  -- 1. 직원: 작성 → 파일 → 검수 요청
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  insert into public.review_items (client_id, kind, period, title, created_by) values (a, 'blog', cur, '백내장 초기 증상', st) returning id into i1;
  insert into public.review_items (client_id, kind, period, title, created_by) values (a, 'blog', cur, '안구건조증 관리', st) returning id into i2;
  insert into public.review_items (client_id, kind, period, title, created_by) values (a, 'blog', cur, '작성 중 원고', st) returning id into i3;
  insert into public.review_files (item_id, client_id, version, file_name, storage_path) values
    (i1, a, 1, '원고.docx', a || '/' || i1 || '/v1/x1.docx'), (i2, a, 1, '원고.docx', a || '/' || i2 || '/v1/x2.docx'), (i3, a, 1, '원고.docx', a || '/' || i3 || '/v1/x3.docx');
  perform public.review_request(i1); perform public.review_request(i2);
  r := r || '1 ' || case when (select count(*) from public.review_items where client_id = a and status = 'pending') = 2 then 'OK' else 'FAIL' end || ';';
  -- 2. 직원은 검수 완료를 직접 입력할 수 없다 (상태 칸 수정 불가) · 검수 결정 함수도 불가
  begin update public.review_items set status = 'approved' where id = i1; r := r || '2 FAIL;';
  exception when insufficient_privilege then r := r || '2 OK;'; end;
  begin perform public.review_decide(i1, 1, true); r := r || '3 FAIL;';
  exception when insufficient_privilege then r := r || '3 OK;'; end;
  -- 4. 요청한 콘텐츠는 지울 수 없다 (작성 중만 삭제)
  delete from public.review_items where id = i1;
  r := r || '4 ' || case when exists (select 1 from public.review_items where id = i1) then 'OK' else 'FAIL' end || ';';

  -- 5. 광고주 A: 작성 중 원고는 안 보이고 요청된 2건만
  perform set_config('request.jwt.claims', json_build_object('sub', ca, 'role', 'authenticated')::text, true);
  select count(*) into n from public.review_items where client_id = a;
  r := r || '5 ' || case when n = 2 then 'OK' else 'FAIL:' || n end || ';';
  -- 6. 검수 완료 + 중복 클릭해도 기록 1건
  perform public.review_decide(i1, 1, true); perform public.review_decide(i1, 1, true);
  select count(*) into n from public.review_events where item_id = i1 and action = 'approve';
  r := r || '6 ' || case when n = 1 and (select status from public.review_items where id = i1) = 'approved' then 'OK' else 'FAIL:' || n end || ';';
  -- 7. 수정 요청 (의견 필수)
  begin perform public.review_decide(i2, 1, false, ''); r := r || '7 FAIL;';
  exception when invalid_parameter_value then r := r || '7 OK;'; end;
  perform public.review_decide(i2, 1, false, '두 번째 문단 내용을 수정해 주세요.');
  r := r || '8 ' || case when (select status from public.review_items where id = i2) = 'changes' then 'OK' else 'FAIL' end || ';';
  -- 9. 광고주 B: A 병원 콘텐츠를 볼 수도, 승인할 수도 없다
  perform set_config('request.jwt.claims', json_build_object('sub', cb, 'role', 'authenticated')::text, true);
  select count(*) into n from public.review_items where client_id = a;
  r := r || '9 ' || case when n = 0 then 'OK' else 'FAIL' end || ';';
  begin perform public.review_decide(i2, 1, true); r := r || '10 FAIL;';
  exception when insufficient_privilege then r := r || '10 OK;'; end;

  -- 11. 직원: 수정본(v2) 등록 → 재검수 대기, 이전 파일 보존
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  insert into public.review_files (item_id, client_id, version, file_name, storage_path) values (i2, a, 2, '원고_수정.docx', a || '/' || i2 || '/v2/y.docx');
  perform public.review_request(i2, true, '두 번째 문단 수정했습니다');
  r := r || '11 ' || case when (select status || version from public.review_items where id = i2) = 'pending2'
                          and (select count(*) from public.review_files where item_id = i2) = 2 then 'OK' else 'FAIL' end || ';';
  -- 12. 광고주: 옛 버전(v1) 승인 시도는 거부, v2 승인
  perform set_config('request.jwt.claims', json_build_object('sub', ca, 'role', 'authenticated')::text, true);
  begin perform public.review_decide(i2, 1, true); r := r || '12 FAIL;';
  exception when invalid_parameter_value then r := r || '12 OK;'; end;
  perform public.review_decide(i2, 2, true);
  r := r || '13 ' || case when (select approved_version from public.review_items where id = i2) = 2 then 'OK' else 'FAIL' end || ';';

  -- 14. 요약: 블로그 요청 2건 모두 승인이지만 계약 3건 → 전체 3 (완료 아님)
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'postgres', true);
  v := public._review_summary(a, cur);
  r := r || '14 ' || case when (v->'kinds'->0->>'approved')::int = 2 and (v->'kinds'->0->>'target')::int = 3 then 'OK' else 'FAIL:' || v::text end || ';';

  -- 15. 로그인하지 않은 요청은 결정 불가
  perform set_config('role', 'anon', true);
  begin perform public.review_decide(i1, 1, true); r := r || '15 FAIL;';
  exception when insufficient_privilege then r := r || '15 OK;'; end;

  raise exception 'RESULT %', r;
end $$;
