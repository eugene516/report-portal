-- 실제 API 응답의 bizmoney 는 소수(예: 604635.13)로 온다 (문서상 long 과 다름) → numeric 으로 저장, 화면에서 원 단위로 반올림
alter table public.naver_account_status alter column bizmoney type numeric(16, 2) using bizmoney::numeric;
