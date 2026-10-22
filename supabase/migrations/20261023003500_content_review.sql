-- 콘텐츠 파일 검수 (월간 리포트 · 성과 집계와 분리된 별도 기능)
-- - 직원: 광고주에게 보낼 콘텐츠(원고 · 이미지)를 등록하고 검수를 요청한다. 수정 요청을 받으면 수정본(새 버전)을 올린다
-- - 광고주: 광고주 계정으로 로그인해야 검수 완료 · 수정 요청을 할 수 있다 (리포트 링크만으로는 불가)
-- - 버전: 수정본을 올릴 때마다 version + 1. 이전 파일 · 검수 기록은 지우지 않는다
--
-- 상태: draft(직원 작성 중, 광고주에게 안 보임) → pending(검수 대기) → approved(검수 완료)
--                                                          ↘ changes(수정 요청) → 수정본 등록 → pending(재검수 대기)

-- 광고주 계정 (직원 명단 staff_roles 와 별개. 이 계정은 can_access_client 를 통과하지 못해 직원 화면 · 데이터에 접근할 수 없다)
create table public.client_users (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  client_id    uuid not null references public.clients (id) on delete cascade,
  name         text check (name is null or length(name) <= 40),
  email        text not null,
  must_change_password boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id)
);
create index on public.client_users (client_id);

create or replace function public.is_client_user(p_client uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.client_users where user_id = auth.uid() and client_id = p_client); $$;
revoke execute on function public.is_client_user(uuid) from public, anon;
grant  execute on function public.is_client_user(uuid) to authenticated;

create table public.review_items (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,
  kind              text not null check (kind in ('blog', 'column', 'cardnews', 'etc')),
  period            text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  title             text not null check (length(btrim(title)) between 1 and 200),
  status            text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'changes')),
  version           int not null default 1 check (version >= 1),         -- 지금 검수받는 버전
  requested_at      timestamptz,                                          -- 지금 버전의 검수 요청일
  approved_version  int,
  approved_at       timestamptz,
  approved_by       uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id),
  updated_at        timestamptz not null default now()
);
create index on public.review_items (client_id, period, status);

create table public.review_files (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.review_items (id) on delete cascade,
  client_id     uuid not null references public.clients (id) on delete cascade,
  version       int not null check (version >= 1),
  file_name     text not null,
  storage_path  text not null unique,
  mime_type     text,
  size_bytes    bigint,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  uploaded_by   uuid references auth.users (id)
);
create index on public.review_files (item_id, version);

create table public.review_events (
  id          bigint generated always as identity primary key,
  item_id     uuid not null references public.review_items (id) on delete cascade,
  client_id   uuid not null references public.clients (id) on delete cascade,
  version     int not null,
  action      text not null check (action in ('request', 'approve', 'changes', 'resubmit')),
  comment     text check (comment is null or length(comment) <= 2000),
  actor       uuid references auth.users (id),
  actor_name  text,
  actor_kind  text not null check (actor_kind in ('staff', 'client')),
  created_at  timestamptz not null default now()
);
create index on public.review_events (item_id, created_at);
-- 같은 버전을 두 번 승인하지 못하게 (중복 클릭 방지)
create unique index review_events_one_approval on public.review_events (item_id, version) where action = 'approve';

-- 권한 ---------------------------------------------------------------------------------------------
alter table public.client_users  enable row level security;
alter table public.review_items  enable row level security;
alter table public.review_files  enable row level security;
alter table public.review_events enable row level security;
revoke all on public.client_users, public.review_items, public.review_files, public.review_events from anon, authenticated;
grant select on public.client_users, public.review_items, public.review_files, public.review_events to authenticated;
grant insert, delete on public.review_items, public.review_files to authenticated;   -- 정책상 직원(담당)만
-- 상태 · 버전 · 승인 정보는 함수로만 바뀐다 (직원이 검수 완료를 직접 입력할 수 없음)
grant update (title, kind, period, updated_at) on public.review_items to authenticated;
grant all on public.client_users, public.review_items, public.review_files, public.review_events to service_role;

create policy "본인 · 담당 직원 조회" on public.client_users for select to authenticated
  using (user_id = auth.uid() or public.can_access_client(client_id));

-- 직원(담당): 전부 / 광고주 계정: 자기 병원의 검수 요청된 콘텐츠만(작성 중 제외) 읽기
create policy "직원 조회" on public.review_items for select to authenticated using (public.can_access_client(client_id));
create policy "직원 등록" on public.review_items for insert to authenticated
  with check (public.can_access_client(client_id) and status = 'draft' and version = 1 and approved_at is null);
create policy "직원 수정" on public.review_items for update to authenticated
  using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));
create policy "직원 삭제(작성 중만)" on public.review_items for delete to authenticated
  using (public.can_access_client(client_id) and status = 'draft');
create policy "광고주 조회" on public.review_items for select to authenticated
  using (status <> 'draft' and public.is_client_user(client_id));
create policy "직원 조회" on public.review_files for select to authenticated using (public.can_access_client(client_id));
-- 파일은 지금 버전(작성 중일 때) 또는 다음 버전(수정본)으로만 올린다. 이미 검수 요청한 버전의 파일은 지울 수 없다
create policy "직원 업로드" on public.review_files for insert to authenticated
  with check (public.can_access_client(client_id) and exists (select 1 from public.review_items i where i.id = item_id and i.client_id = review_files.client_id
              and ((i.status = 'draft' and review_files.version = i.version) or (i.status <> 'draft' and review_files.version = i.version + 1))));
create policy "직원 삭제(요청 전 파일만)" on public.review_files for delete to authenticated
  using (public.can_access_client(client_id) and exists (select 1 from public.review_items i where i.id = item_id
              and ((i.status = 'draft' and review_files.version = i.version) or review_files.version > i.version)));
create policy "광고주 조회" on public.review_files for select to authenticated
  using (public.is_client_user(client_id) and exists (select 1 from public.review_items i where i.id = item_id and i.status <> 'draft'));
create policy "직원 · 광고주 조회" on public.review_events for select to authenticated
  using (public.can_access_client(client_id) or public.is_client_user(client_id));
-- 검수 기록은 아래 함수로만 남긴다 (직접 insert · update · delete 불가)

-- 비공개 저장소: reviews/{client_id}/{item_id}/v{버전}/{임의 이름}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reviews', 'reviews', false, 31457280, array['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
        'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/x-hwp', 'application/haansofthwp', 'text/plain'])
on conflict (id) do nothing;
create policy "검수 파일 직원 업로드" on storage.objects for insert to authenticated
  with check (bucket_id = 'reviews' and public.can_access_client(public.storage_client_of(name)));
-- 저장소 파일은 기록(review_files)이 먼저 지워진 것만 지울 수 있다 → 검수 요청한 버전의 파일은 보존
create policy "검수 파일 직원 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'reviews' and public.can_access_client(public.storage_client_of(name))
         and not exists (select 1 from public.review_files f where f.storage_path = name));
create policy "검수 파일 조회" on storage.objects for select to authenticated
  using (bucket_id = 'reviews' and (public.can_access_client(public.storage_client_of(name))
         or (public.is_client_user(public.storage_client_of(name))
             and exists (select 1 from public.review_files f join public.review_items i on i.id = f.item_id
                          where f.storage_path = name and i.status <> 'draft'))));

-- 직원: 검수 요청 (처음 요청 · 수정본 재요청) -------------------------------------------------------
-- p_new_version = true 이면 수정본: 버전을 올린다 (파일은 새 버전 번호로 미리 올려 둔다)
create or replace function public.review_request(p_item uuid, p_new_version boolean default false, p_comment text default null)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare it public.review_items; v int;
begin
  select * into it from public.review_items where id = p_item for update;
  if it.id is null or not public.can_access_client(it.client_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v := case when p_new_version then it.version + 1 else it.version end;
  if p_new_version and it.status not in ('changes', 'approved', 'pending') then raise exception 'not reviewable' using errcode = '22023'; end if;
  if not p_new_version and it.status <> 'draft' then raise exception 'already requested' using errcode = '22023'; end if;
  if not exists (select 1 from public.review_files where item_id = p_item and version = v) then raise exception 'no files' using errcode = '22023'; end if;
  update public.review_items set status = 'pending', version = v, requested_at = now(), updated_at = now() where id = p_item;
  insert into public.review_events (item_id, client_id, version, action, comment, actor, actor_name, actor_kind)
  values (p_item, it.client_id, v, case when p_new_version then 'resubmit' else 'request' end, nullif(btrim(p_comment), ''),
          auth.uid(), (select coalesce(display_name, email) from public.staff_roles where user_id = auth.uid()), 'staff');
  return jsonb_build_object('status', 'pending', 'version', v);
end;
$$;

-- 광고주: 검수 완료 · 수정 요청 (로그인한 그 병원 광고주 계정만, 지금 버전에만) ---------------------
create or replace function public.review_decide(p_item uuid, p_version int, p_approve boolean, p_comment text default null)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare it public.review_items; who text;
begin
  select * into it from public.review_items where id = p_item for update;
  if it.id is null or not public.is_client_user(it.client_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if it.version <> p_version then raise exception 'stale version' using errcode = '22023'; end if;   -- 그 사이 수정본이 올라옴
  select coalesce(name, email) into who from public.client_users where user_id = auth.uid();
  if p_approve then
    if it.status = 'approved' and it.approved_version = p_version then return jsonb_build_object('status', 'approved', 'version', p_version); end if;   -- 이미 완료(중복 클릭)
    if it.status <> 'pending' then raise exception 'not pending' using errcode = '22023'; end if;
    insert into public.review_events (item_id, client_id, version, action, comment, actor, actor_name, actor_kind)
    values (p_item, it.client_id, p_version, 'approve', nullif(btrim(p_comment), ''), auth.uid(), who, 'client')
    on conflict (item_id, version) where action = 'approve' do nothing;
    update public.review_items set status = 'approved', approved_version = p_version, approved_at = now(), approved_by = auth.uid(), updated_at = now() where id = p_item;
    return jsonb_build_object('status', 'approved', 'version', p_version);
  end if;
  if it.status <> 'pending' then raise exception 'not pending' using errcode = '22023'; end if;
  if nullif(btrim(p_comment), '') is null then raise exception 'comment required' using errcode = '22023'; end if;
  insert into public.review_events (item_id, client_id, version, action, comment, actor, actor_name, actor_kind)
  values (p_item, it.client_id, p_version, 'changes', btrim(p_comment), auth.uid(), who, 'client');
  update public.review_items set status = 'changes', updated_at = now() where id = p_item;
  return jsonb_build_object('status', 'changes', 'version', p_version);
end;
$$;

-- 광고주 계정: 첫 로그인 후 비밀번호를 바꿨음을 기록
create or replace function public.client_user_password_changed()
returns void language sql volatile security definer set search_path = ''
as $$ update public.client_users set must_change_password = false where user_id = auth.uid(); $$;

-- 리포트 링크용 요약 (개수만, 콘텐츠 · 파일 정보 없음): 사이드바 대기 건수 · 대시보드 검수 현황
-- 유형별 전체 = 검수 요청된 건수와 그달 계약 수량 중 큰 값 → 일부만 등록 · 승인된 상태를 '전체 완료'로 표시하지 않는다
create or replace function public._review_summary(p_client uuid, p_period text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'pending', (select count(*) from public.review_items where client_id = p_client and status = 'pending'),
    'kinds', coalesce((
      select jsonb_agg(jsonb_build_object('kind', k.kind, 'requested', k.requested, 'approved', k.approved,
                                          'target', greatest(k.requested, coalesce(q.qty, 0))) order by array_position(array['blog','column','cardnews','etc'], k.kind))
        from (select kind, count(*) filter (where status <> 'draft') requested, count(*) filter (where status = 'approved') approved
                from public.review_items where client_id = p_client and period = p_period group by kind) k
        left join (select service, sum(quantity) qty from public.client_contract_items
                    where client_id = p_client and period = p_period group by service) q on q.service = k.kind
       where k.requested > 0), '[]'::jsonb));
$$;
revoke execute on function public._review_summary(uuid, text) from public, anon, authenticated;

create or replace function public.report_review_summary(p_token text, p_period text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := public.resolve_client_token(p_token);
begin
  if v is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then return null; end if;
  return public._review_summary(v, p_period);
end;
$$;
create or replace function public.staff_review_summary(p_client uuid, p_period text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_access_client(p_client) then raise exception 'forbidden' using errcode = '42501'; end if;
  return public._review_summary(p_client, p_period);
end;
$$;
-- 리포트 링크로 연 화면에서 토큰의 광고주를 확인 (로그인한 광고주 계정이 그 병원 계정인지 화면에서 비교)
create or replace function public.report_client_id(p_token text)
returns uuid language sql volatile security definer set search_path = ''
as $$ select public.resolve_client_token(p_token); $$;

revoke execute on function public.review_request(uuid, boolean, text) from public, anon;
revoke execute on function public.review_decide(uuid, int, boolean, text) from public, anon;
revoke execute on function public.client_user_password_changed() from public, anon;
revoke execute on function public.report_review_summary(text, text) from public;
revoke execute on function public.staff_review_summary(uuid, text) from public, anon;
revoke execute on function public.report_client_id(text) from public;
grant execute on function public.review_request(uuid, boolean, text) to authenticated;
grant execute on function public.review_decide(uuid, int, boolean, text) to authenticated;
grant execute on function public.client_user_password_changed() to authenticated;
grant execute on function public.report_review_summary(text, text) to anon, authenticated;
grant execute on function public.staff_review_summary(uuid, text) to authenticated;
grant execute on function public.report_client_id(text) to anon, authenticated;

-- 변경 이력 대상
create trigger client_users_log after insert or update or delete on public.client_users for each row execute function public._log_change();
create trigger review_items_log after insert or update or delete on public.review_items for each row execute function public._log_change();
