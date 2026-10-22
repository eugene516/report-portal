-- 직원 초대 + 내 정보 수정
-- - must_change_password: 임시 비밀번호로 만든 계정. 첫 로그인 후 비밀번호를 바꿀 때까지 '내 정보 수정' 화면으로 보낸다.
-- - invited_at / invited_by / invite_mailed_at: 초대(재발송) 기록. 임시 비밀번호 자체는 어디에도 저장하지 않는다.

alter table public.staff_roles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists invited_at timestamptz,
  add column if not exists invited_by uuid references auth.users (id) on delete set null,
  add column if not exists invite_mailed_at timestamptz;

-- 본인 이름 변경
create or replace function public.update_my_profile(p_name text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if not exists (select 1 from public.staff_roles where user_id = auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v is null or length(v) > 40 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  update public.staff_roles set display_name = v where user_id = auth.uid();
end;
$$;

-- 본인이 비밀번호를 바꾼 직후 호출: 첫 로그인 비밀번호 변경 안내를 끈다
create or replace function public.mark_password_changed()
returns void
language sql volatile security definer set search_path = ''
as $$ update public.staff_roles set must_change_password = false where user_id = auth.uid(); $$;

revoke execute on function public.update_my_profile(text)  from public, anon;
revoke execute on function public.mark_password_changed()  from public, anon;
grant  execute on function public.update_my_profile(text)  to authenticated;
grant  execute on function public.mark_password_changed()  to authenticated;

-- 직원 현황에 초대·로그인 상태 추가
create or replace function public.staff_overview()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.user_id, 'email', r.email, 'name', coalesce(r.display_name, split_part(r.email, '@', 1)), 'role', r.role, 'createdAt', r.created_at,
      'mustChange', r.must_change_password, 'invitedAt', r.invited_at, 'mailedAt', r.invite_mailed_at, 'lastSignIn', u.last_sign_in_at,
      'clients', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'primary', s.is_primary) order by c.name)
                             from public.client_staff s join public.clients c on c.id = s.client_id where s.user_id = r.user_id), '[]'::jsonb))
      order by case r.role when 'owner' then 0 when 'admin' then 1 else 2 end, r.email)
    from public.staff_roles r left join auth.users u on u.id = r.user_id), '[]'::jsonb);
end;
$$;
