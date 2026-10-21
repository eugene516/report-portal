-- 네이버 성과 자동 수집 예약
-- 실행 시각: 매일 한국시간(Asia/Seoul) 오전 9시
--   Supabase pg_cron 은 UTC 기준으로 동작하므로 '0 0 * * *' (UTC 00:00 = KST 09:00) 로 설정한다.
-- 호출 주소와 호출용 비밀값은 Supabase Vault 에 보관하고(이 파일에는 값이 없다), 실행 시 꺼내 쓴다.
--   vault 이름: naver_sync_url, naver_sync_cron_secret
--   naver_sync_cron_secret 과 같은 값을 함수 비밀값 CRON_SECRET 으로도 등록한다.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'naver-sync-daily-0900-kst',
  '0 0 * * *',   -- UTC 00:00 = 한국시간 09:00
  $job$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'naver_sync_url'),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'naver_sync_cron_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
  $job$
);
