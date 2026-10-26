-- 자사 마케팅(믿는구석 등): 계약 · 견적 없이 진행 항목만 관리하는 광고주 표시
alter table public.clients add column if not exists in_house boolean not null default false;
comment on column public.clients.in_house is '자사 마케팅 — 광고주 목록 · 관리 화면에서 계약 표현 없이 항목만 관리';
update public.clients set in_house = true where name = '믿는구석';
