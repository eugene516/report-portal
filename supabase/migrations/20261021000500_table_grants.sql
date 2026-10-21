-- 테이블 권한 명시
-- 이 프로젝트는 새 테이블에 SELECT/INSERT 등을 자동 부여하지 않고, 대신 TRUNCATE/TRIGGER/REFERENCES 가
-- anon·authenticated 에 열려 있었다. TRUNCATE 는 RLS 를 거치지 않으므로 회수하고, 필요한 권한만 명시한다.

-- 1) 불필요한 권한 회수
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;          -- 광고주(anon)는 함수(report_*)로만 접근

-- 2) 수집 작업(Supabase Edge Function, service_role) — RLS 를 우회하므로 서버 안에서만 사용
grant select, insert, update, delete on all tables in schema public to service_role;

-- 3) 로그인 직원(authenticated) — 실제 행 접근은 RLS 정책(is_staff / is_admin)이 결정
grant select                         on public.clients              to authenticated;
grant insert, update, delete         on public.clients              to authenticated;   -- 정책상 관리자만
grant select                         on public.staff_roles          to authenticated;
grant select, insert, update, delete on public.client_access_tokens to authenticated;   -- 정책상 관리자만
grant select                         on public.client_ad_channels   to authenticated;
grant insert, update, delete         on public.client_ad_channels   to authenticated;   -- 정책상 관리자만
grant select                         on public.naver_campaigns      to authenticated;
grant select                         on public.naver_daily_stats    to authenticated;
grant select                         on public.naver_sync_logs      to authenticated;
grant select                         on public.naver_key_audit_logs to authenticated;   -- 정책상 관리자만
-- naver_ad_accounts, sync_locks: authenticated 권한 없음 (서비스 롤 전용)

-- 4) 앞으로 만드는 테이블도 anon 에 자동으로 열리지 않도록
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;
