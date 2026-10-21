-- 네이버 검색광고 성과 수집 테이블
-- 키 관련 원칙
--   * naver_ad_accounts 는 정책을 하나도 두지 않아 anon/authenticated 접근을 전부 막는다.
--     읽기·쓰기는 Supabase 수집 작업(서비스 롤) 안에서만 한다.
--   * 키는 수집 작업에서 AES-256-GCM 으로 암호화한 값(enc_payload)만 저장한다.
--     암호화 마스터키(ENCRYPTION_KEY)는 Supabase 비밀값에만 있고 DB·코드에는 없다.
--   * 화면에는 끝 4자리(*_last4)만 노출한다.

-- 광고주별 API 계정 -------------------------------------------------------------
create table public.naver_ad_accounts (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null unique references public.clients (id) on delete cascade,
  enc_payload           text not null,         -- base64(iv | ciphertext | tag), 평문 저장 금지
  key_version           int  not null default 1,
  customer_id_last4     text not null,
  access_license_last4  text not null,
  secret_key_last4      text not null,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users (id)
);

-- 캠페인 · 광고그룹 -----------------------------------------------------------
create table public.naver_campaigns (
  client_id      uuid not null references public.clients (id) on delete cascade,
  entity_type    text not null check (entity_type in ('campaign', 'adgroup')),
  ncc_id         text not null,                -- nccCampaignId 또는 nccAdgroupId
  parent_ncc_id  text,                         -- 광고그룹의 상위 캠페인
  name           text not null,
  campaign_type  text,
  status         text,
  updated_at     timestamptz not null default now(),
  primary key (client_id, ncc_id)
);

-- 일별 성과 (캠페인 단위) -------------------------------------------------------
create table public.naver_daily_stats (
  client_id           uuid not null references public.clients (id) on delete cascade,
  stat_date           date not null,
  ncc_campaign_id     text not null,
  impressions         bigint  not null default 0,
  clicks              bigint  not null default 0,
  ctr                 numeric(9, 4),            -- %
  cpc                 numeric(14, 2),           -- 원
  cost                numeric(16, 2) not null default 0,  -- 원 (VAT 포함 여부는 수집 모듈 주석 참고)
  avg_rank            numeric(6, 2),
  conversions         numeric(14, 2) not null default 0,
  conversion_revenue  numeric(16, 2) not null default 0,
  roas                numeric(12, 2),           -- %
  collected_at        timestamptz not null default now(),
  primary key (client_id, stat_date, ncc_campaign_id)   -- upsert 기준
);
create index on public.naver_daily_stats (client_id, stat_date);

-- 수집 이력 ---------------------------------------------------------------------
create table public.naver_sync_logs (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null,
  client_id      uuid references public.clients (id) on delete set null,
  trigger_type   text not null check (trigger_type in ('schedule', 'manual')),
  requested_by   uuid references auth.users (id),
  date_from      date,
  date_to        date,
  status         text not null check (status in ('running', 'success', 'failed', 'skipped')),
  rows_upserted  int not null default 0,
  duration_ms    int,
  error_message  text,                         -- 마스킹된 메시지만 기록
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index on public.naver_sync_logs (started_at desc);
create index on public.naver_sync_logs (client_id, started_at desc);

-- 키 변경 감사 로그 (키 값은 기록하지 않는다) -----------------------------------
create table public.naver_key_audit_logs (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients (id) on delete set null,
  action       text not null check (action in ('create', 'update', 'delete', 'deactivate')),
  actor_id     uuid references auth.users (id),
  actor_email  text,
  created_at   timestamptz not null default now()
);

-- 실행 잠금 (동시에 두 번 수집하지 않도록) ---------------------------------------
create table public.sync_locks (
  name          text primary key,
  holder        uuid,
  locked_until  timestamptz not null default 'epoch'
);
insert into public.sync_locks (name) values ('naver_sync');

create or replace function public.acquire_sync_lock(p_name text, p_holder uuid, p_ttl_seconds int)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ok boolean;
begin
  update public.sync_locks
     set holder = p_holder, locked_until = now() + make_interval(secs => p_ttl_seconds)
   where name = p_name and locked_until < now()
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.release_sync_lock(p_name text, p_holder uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.sync_locks set holder = null, locked_until = 'epoch'
   where name = p_name and holder = p_holder;
$$;

-- RLS ---------------------------------------------------------------------------
alter table public.naver_ad_accounts    enable row level security;
alter table public.naver_campaigns      enable row level security;
alter table public.naver_daily_stats    enable row level security;
alter table public.naver_sync_logs      enable row level security;
alter table public.naver_key_audit_logs enable row level security;
alter table public.sync_locks           enable row level security;

-- 키 테이블·잠금 테이블: 정책 없음 + 권한 회수 (서비스 롤만 접근)
revoke all on public.naver_ad_accounts from anon, authenticated;
revoke all on public.sync_locks        from anon, authenticated;
revoke execute on function public.acquire_sync_lock(text, uuid, int) from public, anon, authenticated;
revoke execute on function public.release_sync_lock(text, uuid)      from public, anon, authenticated;

create policy "직원은 캠페인 조회" on public.naver_campaigns
  for select to authenticated using (public.is_staff());
create policy "직원은 성과 조회" on public.naver_daily_stats
  for select to authenticated using (public.is_staff());
create policy "직원은 수집 이력 조회" on public.naver_sync_logs
  for select to authenticated using (public.is_staff());
create policy "관리자는 감사 로그 조회" on public.naver_key_audit_logs
  for select to authenticated using (public.is_admin());

-- 관리자 화면용: 키는 끝 4자리와 상태만 -------------------------------------------
create or replace function public.admin_naver_account_status()
returns table (
  client_id uuid, customer_id_last4 text, access_license_last4 text, secret_key_last4 text,
  is_active boolean, updated_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select a.client_id, a.customer_id_last4, a.access_license_last4, a.secret_key_last4, a.is_active, a.updated_at
      from public.naver_ad_accounts a;
end;
$$;
revoke execute on function public.admin_naver_account_status() from public, anon;
grant execute on function public.admin_naver_account_status() to authenticated;
