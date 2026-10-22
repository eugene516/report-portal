-- 접근 통제 점검 (원격 DB에서 실행해도 데이터가 남지 않음)
-- 마지막에 일부러 예외를 일으켜 트랜잭션 전체를 되돌리고, 결과는 예외 메시지로 출력한다.
-- 실행: npx supabase db query --linked -f supabase/tests/access_control_check.sql
do $$
declare
  r     text := '';
  v     jsonb;
  a     uuid;   -- 시험 광고주 A
  b     uuid;   -- 시험 광고주 B
  tok   text := 'tok_' || md5(random()::text) || md5(random()::text);
  tok_x text := 'tok_' || md5(random()::text) || md5(random()::text);  -- 만료된 토큰
begin
  insert into public.clients (slug, name) values ('zz-test-a-' || substr(md5(random()::text), 1, 6), '시험광고주A') returning id into a;
  insert into public.clients (slug, name) values ('zz-test-b-' || substr(md5(random()::text), 1, 6), '시험광고주B') returning id into b;
  insert into public.client_access_tokens (client_id, token_hash) values (a, encode(extensions.digest(tok, 'sha256'), 'hex'));
  insert into public.client_access_tokens (client_id, token_hash, expires_at) values (a, encode(extensions.digest(tok_x, 'sha256'), 'hex'), now() - interval '1 day');
  insert into public.client_ad_channels values (a, 'naver', true, true, now()), (b, 'naver', true, true, now());
  insert into public.naver_daily_stats (client_id, stat_date, ncc_campaign_id, impressions, clicks, cost, conversions, conversion_revenue)
       values (a, current_date - 1, 'cmp-a', 1000, 20, 20000, 2, 100000),
              (b, current_date - 1, 'cmp-b', 5000, 90, 77777, 9, 900000);
  insert into public.naver_ad_accounts (client_id, enc_payload, customer_id_last4, access_license_last4, secret_key_last4)
       values (a, 'dummy-ciphertext', '0000', '0000', '0000');

  -- ── 로그인 안 한 사용자(anon) ──
  perform set_config('role', 'anon', true);
  begin perform 1 from public.naver_ad_accounts limit 1; r := r || '1 FAIL;';
  exception when insufficient_privilege then r := r || '1 OK;'; end;                        -- 키 테이블 읽기 차단
  begin perform 1 from public.clients limit 1; r := r || '2 FAIL;';
  exception when insufficient_privilege then r := r || '2 OK;'; end;                        -- 광고주 목록 직접 조회 차단
  begin perform 1 from public.naver_daily_stats limit 1; r := r || '3 FAIL;';
  exception when insufficient_privilege then r := r || '3 OK;'; end;                        -- 성과 직접 조회 차단
  v := public.report_client(tok);
  r := r || '4 ' || case when v->>'name' = '시험광고주A' then 'OK' else 'FAIL' end || ';';  -- 올바른 링크 → A만
  v := public.report_naver(tok, current_date - 7, current_date);
  r := r || '5 ' || case when (v->'kpi'->>'cost')::numeric = 20000 then 'OK' else 'FAIL:' || coalesce(v::text, 'null') end || ';';  -- A 성과만 (B 77777 섞이지 않음)
  r := r || '6 ' || case when public.report_client('tok_wrong' || tok) is null then 'OK' else 'FAIL' end || ';';  -- 틀린 링크
  r := r || '7 ' || case when public.report_client(tok_x) is null then 'OK' else 'FAIL' end || ';';               -- 만료된 링크
  begin perform public.staff_report_naver(b, current_date - 7, current_date); r := r || '8 FAIL;';
  exception when insufficient_privilege then r := r || '8 OK;'; end;                        -- ID로 B 조회 시도 차단
  begin perform public.resolve_client_token(tok); r := r || '9 FAIL;';
  exception when insufficient_privilege then r := r || '9 OK;'; end;                        -- 내부 함수 직접 호출 차단
  begin perform public.is_admin(); r := r || '10 FAIL;';
  exception when insufficient_privilege then r := r || '10 OK;'; end;

  -- ── 로그인했지만 직원이 아닌 사용자 ──
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin perform public.staff_report_naver(a, current_date - 7, current_date); r := r || '11 FAIL;';
  exception when insufficient_privilege then r := r || '11 OK;'; end;                       -- 직원 함수 차단
  r := r || '12 ' || case when (select count(*) from public.naver_daily_stats) = 0 then 'OK' else 'FAIL' end || ';';
  begin perform public.admin_naver_account_status(); r := r || '13 FAIL;';
  exception when insufficient_privilege then r := r || '13 OK;'; end;                       -- 키 상태(끝 4자리)도 관리자만
  begin perform 1 from public.naver_ad_accounts limit 1; r := r || '14 FAIL;';
  exception when insufficient_privilege then r := r || '14 OK;'; end;

  -- ── 직원(staff) / 관리자(admin) ──
  perform set_config('role', 'postgres', true);
  insert into auth.users (id, email, aud, role) values ('00000000-0000-4000-8000-0000000000a1', 'staff-test@example.com', 'authenticated', 'authenticated'),
                                                       ('00000000-0000-4000-8000-0000000000a2', 'admin-test@example.com', 'authenticated', 'authenticated');
  insert into public.staff_roles (user_id, email, role, created_at) values ('00000000-0000-4000-8000-0000000000a1', 'staff-test@example.com', 'staff', now()),
                                        ('00000000-0000-4000-8000-0000000000a2', 'admin-test@example.com', 'admin', now());
  insert into public.client_staff (client_id, user_id, is_primary) values (b, '00000000-0000-4000-8000-0000000000a1', true);   -- 직원은 B 담당
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  v := public.staff_report_naver(b, current_date - 7, current_date);
  r := r || '15 ' || case when (v->'kpi'->>'cost')::numeric = 77777 then 'OK' else 'FAIL' end || ';';        -- 직원은 광고주 성과 조회 가능
  r := r || '16 ' || case when (select count(*) from public.naver_daily_stats) = 1 then 'OK' else 'FAIL' end || ';';          -- 담당(B) 성과만
  r := r || '17 ' || case when (select count(*) from public.admin_naver_account_status()) = 0 then 'OK' else 'FAIL' end || ';'; -- 담당 아닌 A의 키 상태는 안 보임
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
  r := r || '18 ' || case when (select customer_id_last4 from public.admin_naver_account_status() s where s.client_id = a) = '0000' then 'OK' else 'FAIL' end || ';';  -- 관리자는 끝 4자리만
  begin perform 1 from public.naver_ad_accounts limit 1; r := r || '19 FAIL;';
  exception when insufficient_privilege then r := r || '19 OK;'; end;                       -- 관리자도 키 원문 테이블 직접 조회 불가

  raise exception 'ACCESS_CHECK_RESULT %', r;   -- 의도된 예외: 모든 시험 데이터 되돌림
end
$$;
