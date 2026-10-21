-- 권한 구조 점검: 오너·관리자·직원 + 담당 배정 (원격 DB에서 실행해도 데이터가 남지 않음)
-- 실행: npx supabase db query --linked -f supabase/tests/roles_check.sql
do $$
declare
  r text := '';
  a uuid; b uuid;                                        -- 광고주 A(직원1 담당), B(직원2 담당)
  s1 uuid := '00000000-0000-4000-8000-0000000000b1';     -- 직원1
  s2 uuid := '00000000-0000-4000-8000-0000000000b2';     -- 직원2
  ad uuid := '00000000-0000-4000-8000-0000000000b3';     -- 관리자
  ow uuid := '00000000-0000-4000-8000-0000000000b4';     -- 시험용 오너 (기존 오너는 잠시 관리자로)
  n int; v jsonb;
  claims text;
begin
  insert into auth.users (id, email, aud, role) values
    (s1, 's1-test@example.com', 'authenticated', 'authenticated'), (s2, 's2-test@example.com', 'authenticated', 'authenticated'),
    (ad, 'ad-test@example.com', 'authenticated', 'authenticated'), (ow, 'ow-test@example.com', 'authenticated', 'authenticated');
  update public.staff_roles set role = 'admin' where role = 'owner';   -- 시험 동안만 (마지막에 전부 되돌림)
  insert into public.staff_roles (user_id, email, role) values (s1, 's1-test@example.com', 'staff'), (s2, 's2-test@example.com', 'staff'),
                                                               (ad, 'ad-test@example.com', 'admin'), (ow, 'ow-test@example.com', 'owner');
  insert into public.clients (slug, name) values ('zz-role-a-' || substr(md5(random()::text), 1, 6), '권한시험A') returning id into a;
  insert into public.clients (slug, name) values ('zz-role-b-' || substr(md5(random()::text), 1, 6), '권한시험B') returning id into b;
  insert into public.client_staff (client_id, user_id, is_primary) values (a, s1, true), (b, s2, true);
  insert into public.client_ad_channels values (a, 'naver', true, true, now()), (b, 'naver', true, true, now());
  insert into public.naver_daily_stats (client_id, stat_date, ncc_campaign_id, impressions, clicks, cost)
       values (a, current_date - 1, 'c-a', 10, 1, 1000), (b, current_date - 1, 'c-b', 20, 2, 2000);

  perform set_config('role', 'authenticated', true);

  -- ── 직원1 ──
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.clients where id in (a, b);
  r := r || '1 ' || case when n = 1 then 'OK' else 'FAIL:' || n end || ';';                       -- 본인 광고주(A)만 보임
  r := r || '2 ' || case when not exists (select 1 from public.clients where id = b) then 'OK' else 'FAIL' end || ';';
  begin perform public.staff_report_naver(b, current_date - 7, current_date); r := r || '3 FAIL;';
  exception when insufficient_privilege then r := r || '3 OK;'; end;                               -- B 성과 ID로 조회 차단
  v := public.staff_report_naver(a, current_date - 7, current_date);
  r := r || '4 ' || case when (v->'kpi'->>'cost')::numeric = 1000 then 'OK' else 'FAIL' end || ';';   -- A 성과 조회 가능
  select count(*) into n from public.naver_daily_stats where client_id in (a, b);
  r := r || '5 ' || case when n = 1 then 'OK' else 'FAIL:' || n end || ';';
  select count(*) into n from public.staff_roles where user_id in (s2, ad, ow);
  r := r || '6 ' || case when n = 0 then 'OK' else 'FAIL:' || n end || ';';                       -- 다른 직원 정보 안 보임
  begin perform public.set_staff_role(s1, 'admin'); r := r || '7 FAIL;';
  exception when insufficient_privilege then r := r || '7 OK;'; end;                               -- 스스로 관리자 승격 차단
  begin update public.staff_roles set role = 'owner' where user_id = s1; r := r || '8 FAIL;';
  exception when insufficient_privilege then r := r || '8 OK;'; end;                               -- 역할 직접 수정 차단
  begin insert into public.client_staff (client_id, user_id) values (b, s1); r := r || '9 FAIL;';
  exception when insufficient_privilege or check_violation then r := r || '9 OK;'; end;            -- 남의 광고주에 본인 배정 차단
  v := to_jsonb(public.create_client('zz-role-c-' || substr(md5(random()::text), 1, 6), '권한시험C', null, null));
  select count(*) into n from public.client_staff where user_id = s1 and is_primary;
  r := r || '10 ' || case when n = 2 then 'OK' else 'FAIL:' || n end || ';';                       -- 새 광고주 생성 → 본인 주담당

  -- ── 관리자 ──
  perform set_config('request.jwt.claims', json_build_object('sub', ad, 'role', 'authenticated')::text, true);
  select count(*) into n from public.clients where id in (a, b);
  r := r || '11 ' || case when n = 2 then 'OK' else 'FAIL:' || n end || ';';                       -- 전체 광고주
  perform public.set_staff_role(s2, 'admin');
  r := r || '12 ' || case when (select role from public.staff_roles where user_id = s2) = 'admin' then 'OK' else 'FAIL' end || ';';  -- 관리자 지정
  begin perform public.set_staff_role(ow, 'staff'); r := r || '13 FAIL;';
  exception when insufficient_privilege then r := r || '13 OK;'; end;                              -- 오너 강등 차단
  begin perform public.transfer_ownership(ad); r := r || '14 FAIL;';
  exception when insufficient_privilege then r := r || '14 OK;'; end;                              -- 관리자는 오너 양도 불가

  -- ── 오너 ──
  perform set_config('request.jwt.claims', json_build_object('sub', ow, 'role', 'authenticated')::text, true);
  perform public.transfer_ownership(s1);
  r := r || '15 ' || case when (select role from public.staff_roles where user_id = s1) = 'owner'
                           and (select role from public.staff_roles where user_id = ow) = 'admin' then 'OK' else 'FAIL' end || ';';  -- 양도 후 기존 오너 → 관리자
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.staff_roles where role = 'owner';
  r := r || '16 ' || case when n = 1 then 'OK' else 'FAIL:' || n end || ';';                       -- 오너는 항상 1명
  begin insert into auth.users (id, email, aud, role) values ('00000000-0000-4000-8000-0000000000b5', 'x-test@example.com', 'authenticated', 'authenticated');
        insert into public.staff_roles (user_id, email, role) values ('00000000-0000-4000-8000-0000000000b5', 'x-test@example.com', 'owner'); r := r || '17 FAIL;';
  exception when unique_violation then r := r || '17 OK;'; end;                                    -- 두 번째 오너 생성 차단

  raise exception 'ROLES_CHECK_RESULT %', r;
end
$$;
