-- 업무 확인 보드 (구글 태스크 형식): 멤버별 세로 업무 목록
-- - task_members: 보드의 열(멤버). 직원 계정과 연결할 수도(user_id), 이름만 둘 수도 있다
-- - team_tasks  : 멤버별 업무. due_on(업무일, 기본 오늘) · done/done_at(완료)
-- 권한: 직원이면 누구나 업무를 보고 추가·수정·완료·삭제할 수 있다(공유 보드).
--       멤버(열) 추가·삭제·이름 변경은 오너·관리자만.

create table public.task_members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 40),
  user_id     uuid references auth.users (id) on delete set null,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id)
);

create table public.team_tasks (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.task_members (id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 300),
  due_on      date default (now() at time zone 'Asia/Seoul')::date,
  done        boolean not null default false,
  done_at     timestamptz,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id),
  updated_at  timestamptz not null default now()
);
create index on public.team_tasks (member_id, done, due_on);

alter table public.task_members enable row level security;
alter table public.team_tasks   enable row level security;
revoke all on public.task_members, public.team_tasks from anon;
grant select, insert, update, delete on public.task_members, public.team_tasks to authenticated;
grant all on public.task_members, public.team_tasks to service_role;

create policy "직원 조회" on public.task_members for select to authenticated using (public.is_staff());
create policy "관리자 멤버 관리" on public.task_members for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "직원 업무 관리" on public.team_tasks for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 처음 한 번: 현재 직원들을 멤버로 등록 (이후 추가·삭제는 화면에서)
insert into public.task_members (name, user_id, sort)
select coalesce(r.display_name, split_part(r.email, '@', 1)), r.user_id,
       row_number() over (order by case r.role when 'owner' then 0 when 'admin' then 1 else 2 end, r.created_at)
  from public.staff_roles r;
