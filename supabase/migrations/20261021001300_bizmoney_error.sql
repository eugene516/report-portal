-- 비즈머니 조회 실패 사유(마스킹된 메시지) 기록
alter table public.naver_account_status add column if not exists error_message text;
