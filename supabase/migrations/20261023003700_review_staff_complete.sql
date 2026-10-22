-- 파일 검수: 직원 완료 처리 (이미 광고주와 확정한 콘텐츠를 올릴 때)
-- 담당 직원만, 지금 버전에 파일이 있을 때만. 기록에는 '담당자 완료 처리'(actor_kind = staff)로 남고 같은 버전 중복 완료는 막힌다
create or replace function public.review_staff_complete(p_item uuid, p_comment text default null)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare it public.review_items;
begin
  select * into it from public.review_items where id = p_item for update;
  if it.id is null or not public.can_access_client(it.client_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if it.status = 'approved' and it.approved_version = it.version then return jsonb_build_object('status', 'approved', 'version', it.version); end if;
  if it.status not in ('draft', 'pending', 'changes') then raise exception 'not completable' using errcode = '22023'; end if;
  if not exists (select 1 from public.review_files where item_id = p_item and version = it.version) then raise exception 'no files' using errcode = '22023'; end if;
  insert into public.review_events (item_id, client_id, version, action, comment, actor, actor_name, actor_kind)
  values (p_item, it.client_id, it.version, 'approve', nullif(btrim(p_comment), ''),
          auth.uid(), (select coalesce(display_name, email) from public.staff_roles where user_id = auth.uid()), 'staff')
  on conflict (item_id, version) where action = 'approve' do nothing;
  update public.review_items set status = 'approved', approved_version = it.version, approved_at = now(), approved_by = auth.uid(),
         requested_at = coalesce(requested_at, now()), updated_at = now() where id = p_item;
  return jsonb_build_object('status', 'approved', 'version', it.version);
end;
$$;
revoke execute on function public.review_staff_complete(uuid, text) from public, anon;
grant execute on function public.review_staff_complete(uuid, text) to authenticated;
