-- 운영 보완
-- 1) 업무 보드: 광고주 태그 · 메모 · 반복 · 계약 마감 자동 할 일
-- 2) 계약 마감 3일 이내 항목 → 주담당 직원 보드에 자동 등록 (sync_deadline_tasks, 매일 09:05 + 보드 열 때)
-- 3) 변경 이력 activity_logs (누가 언제 무엇을 바꿨는지). 링크 토큰 해시·비밀값은 기록하지 않는다
-- 4) 업무 보드 실시간 반영 (supabase_realtime)
-- 5) 운영 대시보드: 항목별 마지막 수집 시각

-- 1) 업무 보드 ----------------------------------------------------------------------------
alter table public.team_tasks
  add column if not exists client_id uuid references public.clients (id) on delete set null,
  add column if not exists note text check (note is null or length(note) <= 1000),
  add column if not exists repeat text not null default 'none' check (repeat in ('none', 'daily', 'weekly', 'monthly')),
  add column if not exists contract_item_id uuid unique references public.client_contract_items (id) on delete cascade,
  add column if not exists auto boolean not null default false;

-- 반복 업무: 완료하면 다음 회차를 새로 만든다
create or replace function public._task_repeat()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_next date;
begin
  if new.done and not old.done and new.repeat <> 'none' then
    v_next := (coalesce(new.due_on, (now() at time zone 'Asia/Seoul')::date)
               + case new.repeat when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end)::date;
    insert into public.team_tasks (member_id, title, due_on, client_id, note, repeat, created_by)
    values (new.member_id, new.title, v_next, new.client_id, new.note, new.repeat, new.created_by);
  end if;
  return new;
end;
$$;
drop trigger if exists team_tasks_repeat on public.team_tasks;
create trigger team_tasks_repeat after update of done on public.team_tasks for each row execute function public._task_repeat();

-- 2) 계약 마감 자동 할 일 ------------------------------------------------------------------
create or replace function public.sync_deadline_tasks()
returns int language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_period text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  c record; e jsonb; v_member uuid; v_label text; n int := 0;
begin
  -- 로그인한 직원 또는 예약 작업(로그인 없음)만
  if auth.uid() is not null and not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  for c in select m.client_id, cl.name from public.client_month_contracts m join public.clients cl on cl.id = m.client_id where m.period = v_period loop
    select tm.id into v_member from public.client_staff s join public.task_members tm on tm.user_id = s.user_id
     where s.client_id = c.client_id and s.is_primary limit 1;
    if v_member is null then continue; end if;
    for e in select * from jsonb_array_elements(public._contract_items(c.client_id, v_period)) loop
      if e->>'id' is null then continue; end if;
      v_label := coalesce(nullif(e->>'label', ''), case e->>'service' when 'blog' then '블로그' when 'column' then '홈페이지 칼럼' when 'place' then '플레이스'
                   when 'cafe' then '카페 바이럴' when 'daangn' then '당근마켓 바이럴' when 'cardnews' then 'SNS 카드뉴스' when 'review' then '리뷰' when 'aeo' then 'AEO' else '업무' end);
      if (e->>'done')::int >= (e->>'quantity')::int then
        -- 수량을 채우면 자동 할 일도 완료
        update public.team_tasks set done = true, done_at = now(), updated_at = now()
         where contract_item_id = (e->>'id')::uuid and not done;
      elsif (e->>'dueOn')::date <= v_today + 3 then
        insert into public.team_tasks (member_id, title, due_on, client_id, contract_item_id, auto, note)
        values (v_member, format('[%s] %s 마감 (%s/%s)', c.name, v_label, e->>'done', e->>'quantity'), (e->>'dueOn')::date,
                c.client_id, (e->>'id')::uuid, true, '계약 마감 3일 전 자동 등록')
        on conflict (contract_item_id) do update
          set title = excluded.title, due_on = excluded.due_on, updated_at = now()
          where not public.team_tasks.done;
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end;
$$;
revoke execute on function public.sync_deadline_tasks() from public, anon;
grant  execute on function public.sync_deadline_tasks() to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'deadline-tasks-daily-0905-kst';
select cron.schedule('deadline-tasks-daily-0905-kst', '5 0 * * *', $$select public.sync_deadline_tasks()$$);

-- 3) 변경 이력 -------------------------------------------------------------------------------
create table public.activity_logs (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_name  text,
  table_name  text not null,
  action      text not null check (action in ('추가', '수정', '삭제')),
  row_id      text,
  client_id   uuid,
  changes     jsonb
);
create index on public.activity_logs (at desc);
create index on public.activity_logs (client_id, at desc);
alter table public.activity_logs enable row level security;
revoke all on public.activity_logs from anon, authenticated;
grant select on public.activity_logs to authenticated;
grant all on public.activity_logs to service_role;
create policy "관리자 조회" on public.activity_logs for select to authenticated using (public.is_admin());

-- 바뀐 칸만 {칸: [이전, 이후]} 로 남긴다. 비밀값·해시·시각 칸은 제외
create or replace function public._log_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  skip text[] := array['token_hash', 'updated_at', 'created_at', 'last_used_at', 'sort', 'updated_by', 'created_by', 'id'];
  k text; diff jsonb := '{}'::jsonb; row jsonb := coalesce(n, o); v_client uuid;
begin
  for k in select jsonb_object_keys(row) loop
    if k = any (skip) then continue; end if;
    if tg_op = 'UPDATE' then
      if (o->k) is distinct from (n->k) then diff := diff || jsonb_build_object(k, jsonb_build_array(o->k, n->k)); end if;
    else
      diff := diff || jsonb_build_object(k, row->k);
    end if;
  end loop;
  if tg_op = 'UPDATE' and diff = '{}'::jsonb then return null; end if;
  v_client := case when row ? 'client_id' then nullif(row->>'client_id', '')::uuid when tg_table_name = 'clients' then (row->>'id')::uuid end;
  insert into public.activity_logs (actor, actor_name, table_name, action, row_id, client_id, changes)
  values (auth.uid(),
          (select coalesce(display_name, email) from public.staff_roles where user_id = auth.uid()),
          tg_table_name, case tg_op when 'INSERT' then '추가' when 'UPDATE' then '수정' else '삭제' end,
          coalesce(row->>'id', row->>'user_id', row->>'client_id'), v_client, diff);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['clients', 'client_services', 'client_ad_channels', 'client_staff', 'client_month_contracts', 'client_contract_items',
                           'client_quotes', 'client_access_tokens', 'staff_roles', 'task_members', 'team_tasks']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_log', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public._log_change()', t || '_log', t);
  end loop;
end $$;

-- 4) 실시간 반영 ------------------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.team_tasks; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.task_members; exception when duplicate_object then null; end;
end $$;
