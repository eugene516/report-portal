-- 직급 · 담당 업무
-- - staff_roles.job_title / duty: 직원 계정의 직급(대표·부장·차장·과장·대리·주임·사원)과 담당 업무 한 줄
-- - task_members.job_title / duty: 업무 확인 보드 멤버(계정 없는 멤버 포함). 계정과 연결된 멤버는 직원 정보와 함께 바뀐다
-- - 수정은 오너·관리자만: set_staff_profile (직원 계정) / task_members 직접 수정(기존 정책: 관리자만)

alter table public.staff_roles
  add column if not exists job_title text check (job_title is null or job_title in ('대표', '부장', '차장', '과장', '대리', '주임', '사원')),
  add column if not exists duty text check (duty is null or length(duty) <= 100);
alter table public.task_members
  add column if not exists job_title text check (job_title is null or job_title in ('대표', '부장', '차장', '과장', '대리', '주임', '사원')),
  add column if not exists duty text check (duty is null or length(duty) <= 100);

create or replace function public.set_staff_profile(p_user uuid, p_name text, p_title text, p_duty text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare v_name text := nullif(btrim(p_name), ''); v_duty text := nullif(btrim(p_duty), ''); v_title text := nullif(p_title, '');
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_name is not null and length(v_name) > 40 then raise exception 'invalid name' using errcode = '22023'; end if;
  update public.staff_roles
     set display_name = coalesce(v_name, display_name), job_title = v_title, duty = v_duty
   where user_id = p_user;
  if not found then raise exception 'not staff' using errcode = '22023'; end if;
  update public.task_members
     set name = coalesce(v_name, name), job_title = v_title, duty = v_duty
   where user_id = p_user;
end;
$$;
revoke execute on function public.set_staff_profile(uuid, text, text, text) from public, anon;
grant  execute on function public.set_staff_profile(uuid, text, text, text) to authenticated;

-- 직원 목록에 직급 · 담당 업무 추가 (나머지는 20261022001600 과 같음)
create or replace function public.staff_overview()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.user_id, 'email', r.email, 'name', coalesce(r.display_name, split_part(r.email, '@', 1)), 'role', r.role, 'createdAt', r.created_at,
      'jobTitle', r.job_title, 'duty', r.duty,
      'mustChange', r.must_change_password, 'invitedAt', r.invited_at, 'mailedAt', r.invite_mailed_at, 'lastSignIn', u.last_sign_in_at,
      'clients', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'primary', s.is_primary) order by c.name)
                             from public.client_staff s join public.clients c on c.id = s.client_id where s.user_id = r.user_id), '[]'::jsonb))
      order by case r.role when 'owner' then 0 when 'admin' then 1 else 2 end, r.email)
    from public.staff_roles r left join auth.users u on u.id = r.user_id), '[]'::jsonb);
end;
$$;

-- 현재 인원 직급
update public.staff_roles set job_title = '대표' where display_name = '안성열';
update public.staff_roles set job_title = '차장' where display_name = '이유진';
update public.task_members m set job_title = r.job_title from public.staff_roles r where m.user_id = r.user_id;
