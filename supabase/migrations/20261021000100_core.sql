-- 리포트 포털 기본 스키마: 광고주, 직원 권한, 광고주 전용 링크, 광고 채널 계약
-- 원칙
--   * 모든 테이블은 RLS를 켜고, 필요한 읽기만 정책으로 연다.
--   * 웹 서버(Vercel)는 anon 키만 쓴다. 광고주 링크 검증은 security definer 함수가 DB 안에서 한다.
--   * 광고주 링크 토큰은 원문을 저장하지 않고 SHA-256 해시만 저장한다.

create extension if not exists pgcrypto with schema extensions;

-- 광고주 ----------------------------------------------------------------------
create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name        text not null,
  category    text,
  area        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 믿는구석 직원 권한 (Supabase Auth 사용자와 1:1) ------------------------------
create table public.staff_roles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('admin', 'staff')),
  created_at  timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff_roles where user_id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff_roles where user_id = auth.uid() and role = 'admin');
$$;

-- 광고주 전용 링크 (로그인 없이 /r/{token}) -----------------------------------
create table public.client_access_tokens (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  token_hash    text not null unique,          -- encode(sha256(token), 'hex'), 원문 저장 금지
  label         text,
  expires_at    timestamptz,                   -- null = 만료 없음
  revoked_at    timestamptz,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index on public.client_access_tokens (client_id);

-- 토큰 → 광고주 ID. 유효하지 않으면 null. (DB 안에서만 해시 비교)
create or replace function public.resolve_client_token(p_token text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_client uuid;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  update public.client_access_tokens t
     set last_used_at = now()
   where t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and t.revoked_at is null
     and (t.expires_at is null or t.expires_at > now())
  returning t.client_id into v_client;
  return v_client;
end;
$$;

-- 광고 채널 계약 (네이버 · 당근마켓 · 카카오) -----------------------------------
create table public.client_ad_channels (
  client_id      uuid not null references public.clients (id) on delete cascade,
  channel        text not null check (channel in ('naver', 'daangn', 'kakao')),
  contracted     boolean not null default false,
  api_connected  boolean not null default false,
  updated_at     timestamptz not null default now(),
  primary key (client_id, channel)
);

-- RLS -------------------------------------------------------------------------
alter table public.clients              enable row level security;
alter table public.staff_roles          enable row level security;
alter table public.client_access_tokens enable row level security;
alter table public.client_ad_channels   enable row level security;

create policy "직원은 광고주 조회" on public.clients
  for select to authenticated using (public.is_staff());
create policy "관리자는 광고주 관리" on public.clients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "본인 권한 조회" on public.staff_roles
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- 토큰 테이블: 해시라도 직접 조회는 관리자만 (발급·폐기는 관리자 기능에서)
create policy "관리자는 링크 관리" on public.client_access_tokens
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "직원은 채널 계약 조회" on public.client_ad_channels
  for select to authenticated using (public.is_staff());
create policy "관리자는 채널 계약 관리" on public.client_ad_channels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 함수 실행 권한: 토큰 검증은 내부 함수로만 쓰고 외부에 직접 노출하지 않는다
revoke execute on function public.resolve_client_token(text) from public, anon, authenticated;
