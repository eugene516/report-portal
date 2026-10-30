-- 업무관리 · 할일 (오늘 / 보드)
-- 기존 업무 확인 보드(team_tasks)를 대신하는 할일 앱. 기존 team_tasks · task_members 는 지우지 않는다(옛 자료 보관).
-- - todo_columns     : 보드의 열(카테고리). 색 · "나중에" 열 표시(is_later) · 순서
-- - todo_cards       : 할 일 카드. 우선순위(0 없음 · 1 낮음 · 2 보통 · 3 높음) · 마감일(due_on) · ☀ 오늘 표시 날짜(today_on)
--                      · 담당 멤버(assignee_id → task_members, 없으면 null) · 만든 사람(created_by) · 메모 · 완료 · 광고주
--                      · 계약 마감 자동 등록(contract_item_id · auto)
-- - todo_items       : 카드 안 세부 항목(체크리스트). 자기 마감일 · ☀ 오늘 · 담당 · 메모 · 완료
-- - todo_routines    : 멤버별 매일 루틴
-- - todo_routine_logs: 루틴 날짜별 기록 (done 완료 · skip 오늘은 안 함 — 연속 기록은 유지)
-- - todo_history     : 담당자 변경 기록 (DB 트리거가 남긴다. 화면에서는 읽기만)
-- 권한
-- - 직원이면 누구나 카드 · 세부 항목을 보고 추가 · 수정 · 완료 · 삭제 (공유 보드)
-- - 열: 직원 누구나 보기 · 추가 · 수정, 삭제는 오너 · 관리자만 (카드가 남은 열은 지울 수 없음)
-- - 루틴: 직원 누구나 보기, 추가 · 수정 · 삭제 · 기록은 루틴 주인(연결된 직원 계정)과 오너 · 관리자만
-- - 담당자 변경 기록: 직원 누구나 보기, 쓰기는 트리거만
-- 계약 마감 자동 할 일(sync_deadline_tasks)은 이제 todo_cards 에 올린다. 함수 이름 · 예약 작업(매일 09:05)은 그대로.

-- 1) 표 -----------------------------------------------------------------------------------
create table public.todo_columns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 40),
  color       text not null default '#6b7280' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_later    boolean not null default false,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null default auth.uid()
);

create table public.todo_cards (
  id                uuid primary key default gen_random_uuid(),
  column_id         uuid not null references public.todo_columns (id) on delete restrict,
  title             text not null check (length(btrim(title)) between 1 and 300),
  priority          smallint not null default 0 check (priority between 0 and 3),
  due_on            date,
  today_on          date,
  assignee_id       uuid references public.task_members (id) on delete set null,
  note              text check (note is null or length(note) <= 2000),
  done              boolean not null default false,
  done_at           timestamptz,
  sort              int not null default 0,
  client_id         uuid references public.clients (id) on delete set null,
  contract_item_id  uuid unique references public.client_contract_items (id) on delete cascade,
  auto              boolean not null default false,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at        timestamptz not null default now()
);
create index on public.todo_cards (column_id, done, sort);
create index on public.todo_cards (assignee_id) where not done;
create index on public.todo_cards (done_at) where done;

create table public.todo_items (
  id           uuid primary key default gen_random_uuid(),
  card_id      uuid not null references public.todo_cards (id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 300),
  due_on       date,
  today_on     date,
  assignee_id  uuid references public.task_members (id) on delete set null,
  note         text check (note is null or length(note) <= 2000),
  done         boolean not null default false,
  done_at      timestamptz,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at   timestamptz not null default now()
);
create index on public.todo_items (card_id, sort);
create index on public.todo_items (assignee_id) where not done;

create table public.todo_routines (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.task_members (id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 100),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null default auth.uid()
);
create index on public.todo_routines (owner_id, sort);

create table public.todo_routine_logs (
  routine_id  uuid not null references public.todo_routines (id) on delete cascade,
  on_date     date not null,
  status      text not null check (status in ('done', 'skip')),
  created_at  timestamptz not null default now(),
  primary key (routine_id, on_date)
);
create index on public.todo_routine_logs (on_date);

create table public.todo_history (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  card_id     uuid references public.todo_cards (id) on delete cascade,
  item_id     uuid references public.todo_items (id) on delete cascade,
  title       text not null,
  actor       uuid,
  actor_name  text,             -- null 이면 자동(예약 작업)
  from_name   text,             -- null 이면 담당자 없음
  to_name     text
);
create index on public.todo_history (card_id, at desc);
create index on public.todo_history (item_id, at desc);

-- 2) 권한 ---------------------------------------------------------------------------------
alter table public.todo_columns      enable row level security;
alter table public.todo_cards        enable row level security;
alter table public.todo_items        enable row level security;
alter table public.todo_routines     enable row level security;
alter table public.todo_routine_logs enable row level security;
alter table public.todo_history      enable row level security;

revoke all on public.todo_columns, public.todo_cards, public.todo_items, public.todo_routines, public.todo_routine_logs, public.todo_history from anon;
grant select, insert, update, delete on public.todo_columns, public.todo_cards, public.todo_items, public.todo_routines, public.todo_routine_logs to authenticated;
revoke all on public.todo_history from authenticated;
grant select on public.todo_history to authenticated;
grant all on public.todo_columns, public.todo_cards, public.todo_items, public.todo_routines, public.todo_routine_logs, public.todo_history to service_role;

create policy "직원 조회" on public.todo_columns for select to authenticated using (public.is_staff());
create policy "직원 열 추가" on public.todo_columns for insert to authenticated with check (public.is_staff());
create policy "직원 열 수정" on public.todo_columns for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "관리자 열 삭제" on public.todo_columns for delete to authenticated using (public.is_admin());

create policy "직원 카드 관리" on public.todo_cards for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "직원 세부 항목 관리" on public.todo_items for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 루틴 주인: 루틴의 멤버가 로그인한 직원 계정과 연결되어 있을 때
create or replace function public.todo_owns_member(p_member uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.task_members m where m.id = p_member and m.user_id = auth.uid()) $$;
revoke execute on function public.todo_owns_member(uuid) from public, anon;
grant  execute on function public.todo_owns_member(uuid) to authenticated;

create policy "직원 조회" on public.todo_routines for select to authenticated using (public.is_staff());
create policy "주인·관리자 루틴 관리" on public.todo_routines for all to authenticated
  using (public.is_staff() and (public.is_admin() or public.todo_owns_member(owner_id)))
  with check (public.is_staff() and (public.is_admin() or public.todo_owns_member(owner_id)));

create policy "직원 조회" on public.todo_routine_logs for select to authenticated using (public.is_staff());
create policy "주인·관리자 루틴 기록" on public.todo_routine_logs for all to authenticated
  using (public.is_staff() and (public.is_admin() or exists (select 1 from public.todo_routines r where r.id = routine_id and public.todo_owns_member(r.owner_id))))
  with check (public.is_staff() and (public.is_admin() or exists (select 1 from public.todo_routines r where r.id = routine_id and public.todo_owns_member(r.owner_id))));

create policy "직원 조회" on public.todo_history for select to authenticated using (public.is_staff());

-- 3) 트리거 -------------------------------------------------------------------------------
-- 완료 시각 · 수정 시각은 DB가 맞춘다 (화면은 done 만 바꾸면 된다)
create or replace function public._todo_touch()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.done and new.done_at is null then new.done_at := now(); end if;
    if not new.done then new.done_at := null; end if;
  else
    if new.done and not old.done then new.done_at := coalesce(new.done_at, now()); end if;
    if new.done and old.done then new.done_at := coalesce(new.done_at, old.done_at, now()); end if;
    if not new.done then new.done_at := null; end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger todo_cards_touch before insert or update on public.todo_cards for each row execute function public._todo_touch();
create trigger todo_items_touch before insert or update on public.todo_items for each row execute function public._todo_touch();

-- 담당자 변경 기록: 바뀔 때마다, 새로 만들 때는 다른 사람에게 맡겼을 때(또는 자동 등록)만
create or replace function public._todo_assign_log()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_from text; v_to text;
begin
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return null; end if;
  if tg_op = 'INSERT' and (new.assignee_id is null
     or exists (select 1 from public.task_members m where m.id = new.assignee_id and m.user_id = auth.uid())) then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.assignee_id is not null then
    select name into v_from from public.task_members where id = old.assignee_id;
  end if;
  if new.assignee_id is not null then
    select name into v_to from public.task_members where id = new.assignee_id;
  end if;
  insert into public.todo_history (card_id, item_id, title, actor, actor_name, from_name, to_name)
  -- todo_cards 에는 card_id 칸이 없으므로 jsonb 로 꺼낸다
  values (case when tg_table_name = 'todo_cards' then new.id else (to_jsonb(new) ->> 'card_id')::uuid end,
          case when tg_table_name = 'todo_items' then new.id end,
          new.title, auth.uid(),
          (select coalesce(display_name, split_part(email, '@', 1)) from public.staff_roles where user_id = auth.uid()),
          v_from, v_to);
  return null;
end;
$$;
create trigger todo_cards_assign_log after insert or update of assignee_id on public.todo_cards for each row execute function public._todo_assign_log();
create trigger todo_items_assign_log after insert or update of assignee_id on public.todo_items for each row execute function public._todo_assign_log();

-- 4) 로그인한 직원의 멤버 (없으면 만든다) ----------------------------------------------------
-- "지금 보는 사람" = 로그인한 직원. 멤버 관리 화면이 없어져도 새 직원이 바로 할일을 쓸 수 있게 한다.
create or replace function public.todo_my_member()
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_id from public.task_members where user_id = auth.uid() order by created_at limit 1;
  if v_id is null then
    insert into public.task_members (name, user_id, job_title, duty, sort, created_by)
    select left(coalesce(nullif(btrim(r.display_name), ''), split_part(r.email, '@', 1)), 40), r.user_id, r.job_title, r.duty,
           coalesce((select max(sort) from public.task_members), 0) + 1, r.user_id
      from public.staff_roles r where r.user_id = auth.uid()
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.todo_my_member() from public, anon;
grant  execute on function public.todo_my_member() to authenticated;

-- 5) 기본 열 ------------------------------------------------------------------------------
insert into public.todo_columns (name, color, is_later, sort, created_by) values
  ('개인 업무',          '#dc2626', false, 1, null),
  ('단기프로젝트',       '#ea580c', false, 2, null),
  ('장기 프로젝트',      '#2563eb', false, 3, null),
  ('기업&기타 PJT 공유', '#059669', false, 4, null),
  ('나중에',             '#6b7280', true,  5, null);

-- 6) 기존 업무(team_tasks) 옮기기 ------------------------------------------------------------
-- - 반복 업무(repeat <> 'none')이면서 아직 안 끝난 것 → 담당 멤버의 매일 루틴 (같은 멤버 · 같은 제목은 하나만)
-- - 나머지 → "개인 업무" 열 카드 (담당 = 멤버, 마감일 = 업무일, 완료 · 메모 · 광고주 · 계약 마감 연결 유지)
insert into public.todo_routines (owner_id, title, sort, created_at, created_by)
select distinct on (t.member_id, left(btrim(t.title), 100))
       t.member_id, left(btrim(t.title), 100), 0, t.created_at, t.created_by
  from public.team_tasks t
 where t.repeat <> 'none' and not t.done
 order by t.member_id, left(btrim(t.title), 100), t.created_at;

insert into public.todo_cards (column_id, title, due_on, assignee_id, note, done, done_at, sort, client_id, contract_item_id, auto, created_at, created_by, updated_at)
select (select id from public.todo_columns where not is_later order by sort limit 1),
       t.title, t.due_on, t.member_id, t.note, t.done, case when t.done then coalesce(t.done_at, t.updated_at) end, t.sort,
       t.client_id, t.contract_item_id, t.auto, t.created_at, t.created_by, t.updated_at
  from public.team_tasks t
 where t.repeat = 'none' or t.done;

-- 옮긴 자료의 담당자 기록은 남기지 않는다 (위 insert 는 auth.uid() 가 없어 "자동"으로 남으므로 지운다)
delete from public.todo_history;

-- 변경 이력(activity_logs): 20261022002500 과 같은 방식. 옮기기가 끝난 뒤에 건다(옮긴 자료는 기록하지 않음)
do $$
declare t text;
begin
  foreach t in array array['todo_columns', 'todo_cards', 'todo_items', 'todo_routines']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_log', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public._log_change()', t || '_log', t);
  end loop;
end $$;

-- 7) 계약 마감 자동 할 일 → todo_cards ---------------------------------------------------------
-- 20261022002500 과 같은 동작: 이번 달 계약 항목 중 마감 3일 이내이고 수량을 못 채운 항목을 주담당 직원(멤버)에게 올리고,
-- 수량을 채우면 자동으로 완료한다. 같은 항목은 한 장만(contract_item_id 고유). 완료된 카드는 다시 바꾸지 않는다.
-- 카드는 "나중에"가 아닌 첫 번째 열에 놓는다.
create or replace function public.sync_deadline_tasks()
returns int language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_period text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  c record; e jsonb; v_member uuid; v_label text; v_col uuid; n int := 0;
begin
  -- 로그인한 직원 또는 예약 작업(로그인 없음)만
  if auth.uid() is not null and not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_col from public.todo_columns where not is_later order by sort, created_at limit 1;
  if v_col is null then select id into v_col from public.todo_columns order by sort, created_at limit 1; end if;
  for c in select m.client_id, cl.name from public.client_month_contracts m join public.clients cl on cl.id = m.client_id where m.period = v_period loop
    v_member := null;
    select tm.id into v_member from public.client_staff s join public.task_members tm on tm.user_id = s.user_id
     where s.client_id = c.client_id and s.is_primary order by tm.created_at limit 1;
    if v_member is null then continue; end if;
    for e in select * from jsonb_array_elements(public._contract_items(c.client_id, v_period)) loop
      if e->>'id' is null then continue; end if;
      v_label := coalesce(nullif(e->>'label', ''), case e->>'service' when 'blog' then '블로그' when 'column' then '홈페이지 칼럼' when 'place' then '플레이스'
                   when 'cafe' then '카페 바이럴' when 'daangn' then '당근마켓 바이럴' when 'cardnews' then 'SNS 카드뉴스' when 'review' then '리뷰' when 'aeo' then 'AEO' else '업무' end);
      if (e->>'done')::int >= (e->>'quantity')::int then
        -- 수량을 채우면 자동 할 일도 완료
        update public.todo_cards set done = true, done_at = now()
         where contract_item_id = (e->>'id')::uuid and not done;
      elsif (e->>'dueOn')::date <= v_today + 3 then
        if v_col is null then continue; end if;
        insert into public.todo_cards (column_id, assignee_id, title, due_on, client_id, contract_item_id, auto, note, created_by)
        values (v_col, v_member, format('[%s] %s 마감 (%s/%s)', c.name, v_label, e->>'done', e->>'quantity'), (e->>'dueOn')::date,
                c.client_id, (e->>'id')::uuid, true, '계약 마감 3일 전 자동 등록', null)
        on conflict (contract_item_id) do update
          set title = excluded.title, due_on = excluded.due_on
          where not public.todo_cards.done;
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end;
$$;
revoke execute on function public.sync_deadline_tasks() from public, anon;
grant  execute on function public.sync_deadline_tasks() to authenticated;
-- 예약 작업 'deadline-tasks-daily-0905-kst' 는 같은 함수 이름을 부르므로 다시 등록하지 않는다.

-- 8) 실시간 반영 ------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['todo_columns', 'todo_cards', 'todo_items', 'todo_routines', 'todo_routine_logs', 'todo_history']
  loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when duplicate_object then null; end;
  end loop;
end $$;
