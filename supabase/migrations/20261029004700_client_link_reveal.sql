-- 광고주 링크 다시 보기: 토큰 암호문(AES-256-GCM, 마스터키는 Edge Function 비밀값 ENCRYPTION_KEY) 저장
-- 접속 확인은 지금처럼 token_hash 로만 한다. 이전에 발급한 링크(암호문 없음)는 다시 볼 수 없다.
alter table public.client_access_tokens add column if not exists token_enc text;
