-- 권한 구조: 오너(1명) · 관리자 · 직원 + 광고주 담당 배정(주담당 1명 + 보조)
-- 원칙
--   * 오너·관리자: 전체 광고주와 직원별 담당 현황 조회
--   * 직원: 본인이 담당(주·보조)하는 광고주만 조회·관리. 다른 직원 광고주는 DB 접근 규칙으로 차단
--   * 모든 광고주 데이터 접근은 can_access_client(client_id) 하나로 판단한다

-- 1) 역할에 owner 추가 + 표시 이름 --------------------------------------------------
alter table public.staff_roles drop constraint staff_roles_role_check;
alter table public.staff_roles add constraint staff_roles_role_check check (role in ('owner', 'admin', 'staff'));
alter table public.staff_roles add column if not exists display_name text;
create unique index staff_roles_single_owner on public.staff_roles ((true)) where role = 'owner';   -- 오너는 항상 1명

-- 현재 관리자(eugene@)를 오너로
update public.staff_roles set role = 'owner' where email = 'eugene@believe-corner.com';

-- 2) 담당 배정 -------------------------------------------------------------------
create table public.client_staff (
  client_id   uuid not null references public.clients (id) on delete cascade,
  user_id     uuid not null references public.staff_roles (user_id) on delete cascade,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id),
  primary key (client_id, user_id)
);
create unique index client_staff_one_primary on public.client_staff (client_id) where is_primary;
create index on public.client_staff (user_id);

-- 3) 권한 판단 함수 ----------------------------------------------------------------
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.staff_roles where user_id = auth.uid() and role = 'owner'); $$;

-- 관리자 = 오너 또는 관리자
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.staff_roles where user_id = auth.uid() and role in ('owner', 'admin')); $$;

create or replace function public.can_access_client(p_client uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_admin()
      or exists (select 1 from public.client_staff s
                  join public.staff_roles r on r.user_id = s.user_id
                 where s.client_id = p_client and s.user_id = auth.uid());
$$;

create or replace function public.is_primary_of(p_client uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.client_staff where client_id = p_client and user_id = auth.uid() and is_primary); $$;

revoke execute on function public.is_owner()                from public, anon;
revoke execute on function public.can_access_client(uuid)   from public, anon;
revoke execute on function public.is_primary_of(uuid)       from public, anon;
grant  execute on function public.is_owner()                to authenticated;
grant  execute on function public.can_access_client(uuid)   to authenticated;
grant  execute on function public.is_primary_of(uuid)       to authenticated;

-- 4) 정책 교체: "직원이면 전체" → "담당이거나 관리자" ----------------------------------
drop policy "직원은 광고주 조회"     on public.clients;
drop policy "관리자는 광고주 관리"   on public.clients;
create policy "담당·관리자 광고주 조회" on public.clients for select to authenticated using (public.can_access_client(id));
create policy "담당·관리자 광고주 수정" on public.clients for update to authenticated using (public.can_access_client(id)) with check (public.can_access_client(id));
create policy "관리자 광고주 삭제"     on public.clients for delete to authenticated using (public.is_admin());
-- 광고주 생성은 create_client() 함수로만 (생성자를 주담당으로 자동 배정하기 위해)

drop policy "본인 권한 조회" on public.staff_roles;
create policy "본인·관리자 직원 조회" on public.staff_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.client_staff a join public.client_staff b on a.client_id = b.client_id
                     where a.user_id = auth.uid() and b.user_id = staff_roles.user_id));   -- 같은 광고주 담당자끼리만 서로 보임

drop policy "관리자는 링크 관리" on public.client_access_tokens;
create policy "담당·관리자 링크 관리" on public.client_access_tokens for all to authenticated
  using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));

drop policy "직원은 채널 계약 조회"   on public.client_ad_channels;
drop policy "관리자는 채널 계약 관리" on public.client_ad_channels;
create policy "담당·관리자 채널 계약" on public.client_ad_channels for all to authenticated
  using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));

drop policy "직원은 캠페인 조회"     on public.naver_campaigns;
drop policy "직원은 성과 조회"       on public.naver_daily_stats;
drop policy "직원은 수집 이력 조회"  on public.naver_sync_logs;
drop policy "관리자는 감사 로그 조회" on public.naver_key_audit_logs;
create policy "담당·관리자 캠페인 조회"  on public.naver_campaigns      for select to authenticated using (public.can_access_client(client_id));
create policy "담당·관리자 성과 조회"    on public.naver_daily_stats    for select to authenticated using (public.can_access_client(client_id));
create policy "담당·관리자 수집 이력"    on public.naver_sync_logs      for select to authenticated using (public.is_admin() or (client_id is not null and public.can_access_client(client_id)));
create policy "담당·관리자 감사 로그"    on public.naver_key_audit_logs for select to authenticated using (public.is_admin() or (client_id is not null and public.can_access_client(client_id)));

alter table public.client_staff enable row level security;
grant select, insert, update, delete on public.client_staff to authenticated;
grant select, insert, update, delete on public.client_staff to service_role;
create policy "담당·관리자 배정 조회" on public.client_staff for select to authenticated using (public.can_access_client(client_id));
create policy "관리자·주담당 배정 관리" on public.client_staff for all to authenticated
  using (public.is_admin() or public.is_primary_of(client_id)) with check (public.is_admin() or public.is_primary_of(client_id));

-- 5) 화면용 함수의 권한 검사도 담당 기준으로 ------------------------------------------
create or replace function public.staff_report_client(p_client uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  return public._client_summary(p_client);
end;
$$;

create or replace function public.staff_report_naver(p_client uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public._check_range(p_from, p_to);
  if not exists (select 1 from public.client_ad_channels
                  where client_id = p_client and channel = 'naver' and contracted and api_connected) then
    return jsonb_build_object('notContracted', true);
  end if;
  return public._naver_report(p_client, p_from, p_to);
end;
$$;

-- 키 상태(끝 4자리): 관리자는 전체, 담당 직원은 본인 광고주만
create or replace function public.admin_naver_account_status()
returns table (client_id uuid, customer_id_last4 text, access_license_last4 text, secret_key_last4 text, is_active boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.staff_roles where user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select a.client_id, a.customer_id_last4, a.access_license_last4, a.secret_key_last4, a.is_active, a.updated_at
      from public.naver_ad_accounts a
     where public.can_access_client(a.client_id);
end;
$$;

-- 6) 광고주 생성 (직원 누구나, 생성자 = 주담당) ----------------------------------------
create or replace function public.create_client(p_slug text, p_name text, p_category text, p_area text)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid;
begin
  if not exists (select 1 from public.staff_roles where user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.clients (slug, name, category, area) values (p_slug, p_name, p_category, p_area) returning id into v;
  insert into public.client_staff (client_id, user_id, is_primary, created_by) values (v, auth.uid(), true, auth.uid());
  insert into public.client_ad_channels (client_id, channel) values (v, 'naver'), (v, 'daangn'), (v, 'kakao');
  return v;
end;
$$;
revoke execute on function public.create_client(text, text, text, text) from public, anon;
grant  execute on function public.create_client(text, text, text, text) to authenticated;

-- 7) 권한 관리 (관리자 지정·해제, 오너 양도) -----------------------------------------
-- 관리자 이상: 직원 ↔ 관리자 변경 (오너는 이 함수로 바꿀 수 없음)
create or replace function public.set_staff_role(p_user uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('admin', 'staff') then raise exception 'invalid role' using errcode = '22023'; end if;
  if exists (select 1 from public.staff_roles where user_id = p_user and role = 'owner') then
    raise exception '오너 권한은 양도로만 바꿀 수 있습니다' using errcode = '42501';
  end if;
  update public.staff_roles set role = p_role where user_id = p_user;
end;
$$;

-- 오너만: 다른 직원에게 오너 양도 (기존 오너는 관리자가 된다)
create or replace function public.transfer_ownership(p_new_owner uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_new_owner = auth.uid() then return; end if;
  if not exists (select 1 from public.staff_roles where user_id = p_new_owner) then
    raise exception '등록된 직원에게만 양도할 수 있습니다' using errcode = '22023';
  end if;
  update public.staff_roles set role = 'admin' where user_id = auth.uid();
  update public.staff_roles set role = 'owner' where user_id = p_new_owner;
end;
$$;

revoke execute on function public.set_staff_role(uuid, text)     from public, anon;
revoke execute on function public.transfer_ownership(uuid)       from public, anon;
grant  execute on function public.set_staff_role(uuid, text)     to authenticated;
grant  execute on function public.transfer_ownership(uuid)       to authenticated;

-- 직원 목록 변경(역할)은 함수로만: 직접 update 권한은 주지 않는다
revoke insert, update, delete on public.staff_roles from authenticated;
