-- 카드뉴스 이미지별 수정 요청 코멘트 점검 (원격 DB에서 실행해도 데이터가 남지 않음)
-- 실행: npx supabase db query --linked -f supabase/tests/review_file_comment_check.sql
do $$
declare
  r text := '';
  st uuid := '00000000-0000-4000-8000-0000000000c1';   -- 담당 직원
  ca uuid := '00000000-0000-4000-8000-0000000000c2';   -- 광고주 A 계정
  cb uuid := '00000000-0000-4000-8000-0000000000c3';   -- 광고주 B 계정
  a uuid; b uuid; i1 uuid; i2 uuid; f1 uuid; f2 uuid; fx uuid;
  cur text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
begin
  insert into auth.users (id, email, aud, role) values
    (st, 'rc1@example.com', 'authenticated', 'authenticated'), (ca, 'rc2@example.com', 'authenticated', 'authenticated'), (cb, 'rc3@example.com', 'authenticated', 'authenticated');
  insert into public.staff_roles (user_id, email, role) values (st, 'rc1@example.com', 'staff');
  insert into public.clients (slug, name) values ('zz-rf-a-' || substr(md5(random()::text), 1, 6), '코멘트시험A') returning id into a;
  insert into public.clients (slug, name) values ('zz-rf-b-' || substr(md5(random()::text), 1, 6), '코멘트시험B') returning id into b;
  insert into public.client_staff (client_id, user_id, is_primary) values (a, st, true);
  insert into public.client_users (user_id, client_id, email, name) values (ca, a, 'rc2@example.com', 'A원장'), (cb, b, 'rc3@example.com', 'B원장');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  insert into public.review_items (client_id, kind, period, title, created_by) values (a, 'cardnews', cur, '29회차 야맹증', st) returning id into i1;
  insert into public.review_items (client_id, kind, period, title, created_by) values (a, 'cardnews', cur, '30회차 영양제', st) returning id into i2;
  insert into public.review_files (item_id, client_id, version, file_name, storage_path) values (i1, a, 1, '1.png', a || '/' || i1 || '/v1/1.png') returning id into f1;
  insert into public.review_files (item_id, client_id, version, file_name, storage_path) values (i1, a, 1, '2.png', a || '/' || i1 || '/v1/2.png') returning id into f2;
  insert into public.review_files (item_id, client_id, version, file_name, storage_path) values (i2, a, 1, '1.png', a || '/' || i2 || '/v1/1.png') returning id into fx;
  perform public.review_request(i1); perform public.review_request(i2);

  -- 1. 광고주 A: 이미지 1에 코멘트 → 재검수 요청 상태 + 이미지 연결
  perform set_config('request.jwt.claims', json_build_object('sub', ca, 'role', 'authenticated')::text, true);
  perform public.review_file_comment(i1, f1, 1, '첫 줄 문구 수정');
  r := r || '1 ' || case when (select status from public.review_items where id = i1) = 'changes'
        and exists (select 1 from public.review_events where item_id = i1 and file_id = f1 and actor_kind = 'client') then 'OK' else 'FAIL' end || ';';
  -- 2. 재검수 요청 중에도 다른 이미지에 계속 남길 수 있다
  perform public.review_file_comment(i1, f2, 1, '로고 크기 줄여 주세요');
  r := r || '2 ' || case when (select count(*) from public.review_events where item_id = i1 and file_id is not null) = 2 then 'OK' else 'FAIL' end || ';';
  -- 3. 다른 콘텐츠의 이미지로는 불가
  begin perform public.review_file_comment(i1, fx, 1, 'x'); r := r || '3 FAIL;';
  exception when others then r := r || case when sqlerrm = 'file not in version' then '3 OK;' else '3 FAIL(' || sqlerrm || ');' end; end;
  -- 4. 지난 버전 번호면 불가
  begin perform public.review_file_comment(i1, f1, 2, 'x'); r := r || '4 FAIL;';
  exception when others then r := r || case when sqlerrm = 'stale version' then '4 OK;' else '4 FAIL(' || sqlerrm || ');' end; end;
  -- 5. 빈 코멘트 불가
  begin perform public.review_file_comment(i2, fx, 1, '  '); r := r || '5 FAIL;';
  exception when others then r := r || case when sqlerrm = 'comment required' then '5 OK;' else '5 FAIL(' || sqlerrm || ');' end; end;
  -- 6. 다른 병원 광고주 계정은 불가
  perform set_config('request.jwt.claims', json_build_object('sub', cb, 'role', 'authenticated')::text, true);
  begin perform public.review_file_comment(i2, fx, 1, 'x'); r := r || '6 FAIL;';
  exception when insufficient_privilege then r := r || '6 OK;'; end;
  -- 7. 검수 완료된 콘텐츠에는 광고주가 남길 수 없다
  perform set_config('request.jwt.claims', json_build_object('sub', ca, 'role', 'authenticated')::text, true);
  perform public.review_decide(i2, 1, true);
  begin perform public.review_file_comment(i2, fx, 1, 'x'); r := r || '7 FAIL;';
  exception when others then r := r || case when sqlerrm = 'not reviewable' then '7 OK;' else '7 FAIL(' || sqlerrm || ');' end; end;
  -- 8. 담당 직원은 남길 수 있다 (기록은 직원)
  perform set_config('request.jwt.claims', json_build_object('sub', st, 'role', 'authenticated')::text, true);
  perform public.review_file_comment(i2, fx, 1, '전화로 받은 수정 사항');
  r := r || '8 ' || case when exists (select 1 from public.review_events where item_id = i2 and file_id = fx and actor_kind = 'staff') then 'OK' else 'FAIL' end || ';';
  -- 9. 비로그인 실행 권한 없음
  r := r || '9 ' || case when has_function_privilege('anon', 'public.review_file_comment(uuid, uuid, int, text)', 'execute') then 'FAIL' else 'OK' end || ';';
  raise exception 'RESULT %', r;
end $$;
