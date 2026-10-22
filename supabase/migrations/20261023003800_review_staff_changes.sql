-- 파일 검수: 직원도 목록에서 '재검수 요청'(수정 필요) 표시 — 광고주가 전화 · 메신저로 수정을 요청한 경우
-- 담당 직원만, 코멘트 필수. 기록에는 actor_kind = staff 로 남는다
create or replace function public.review_staff_changes(p_item uuid, p_comment text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare it public.review_items;
begin
  select * into it from public.review_items where id = p_item for update;
  if it.id is null or not public.can_access_client(it.client_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if nullif(btrim(p_comment), '') is null then raise exception 'comment required' using errcode = '22023'; end if;
  if it.status not in ('draft', 'pending', 'approved') then raise exception 'not changeable' using errcode = '22023'; end if;
  insert into public.review_events (item_id, client_id, version, action, comment, actor, actor_name, actor_kind)
  values (p_item, it.client_id, it.version, 'changes', btrim(p_comment),
          auth.uid(), (select coalesce(display_name, email) from public.staff_roles where user_id = auth.uid()), 'staff');
  update public.review_items set status = 'changes', requested_at = coalesce(requested_at, now()), updated_at = now() where id = p_item;
  return jsonb_build_object('status', 'changes', 'version', it.version);
end;
$$;
revoke execute on function public.review_staff_changes(uuid, text) from public, anon;
grant execute on function public.review_staff_changes(uuid, text) to authenticated;
