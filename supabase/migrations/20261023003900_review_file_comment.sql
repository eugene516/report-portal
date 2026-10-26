-- 파일 검수: 카드뉴스 이미지별 수정 요청 코멘트
-- 이미지(파일) 하나를 열어 보고 그 이미지에 코멘트를 남긴다 → 콘텐츠는 '재검수 요청' 상태가 되고, 같은 버전 동안은 다른 이미지에도 계속 남길 수 있다
alter table public.review_events add column file_id uuid references public.review_files (id) on delete set null;
create index on public.review_events (file_id) where file_id is not null;

create or replace function public.review_file_comment(p_item uuid, p_file uuid, p_version int, p_comment text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare it public.review_items; kind text; who text;
begin
  select * into it from public.review_items where id = p_item for update;
  if it.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if public.is_client_user(it.client_id) then
    kind := 'client';
    if it.status not in ('pending', 'changes') then raise exception 'not reviewable' using errcode = '22023'; end if;
    select coalesce(name, email) into who from public.client_users where user_id = auth.uid();
  elsif public.can_access_client(it.client_id) then
    kind := 'staff';
    select coalesce(display_name, email) into who from public.staff_roles where user_id = auth.uid();
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if it.version <> p_version then raise exception 'stale version' using errcode = '22023'; end if;
  if nullif(btrim(p_comment), '') is null then raise exception 'comment required' using errcode = '22023'; end if;
  if not exists (select 1 from public.review_files where id = p_file and item_id = p_item and version = it.version) then raise exception 'file not in version' using errcode = '22023'; end if;
  insert into public.review_events (item_id, client_id, version, action, comment, actor, actor_name, actor_kind, file_id)
  values (p_item, it.client_id, it.version, 'changes', btrim(p_comment), auth.uid(), who, kind, p_file);
  update public.review_items set status = 'changes', requested_at = coalesce(requested_at, now()), updated_at = now() where id = p_item;
  return jsonb_build_object('status', 'changes', 'version', it.version);
end;
$$;
revoke execute on function public.review_file_comment(uuid, uuid, int, text) from public, anon;
grant execute on function public.review_file_comment(uuid, uuid, int, text) to authenticated;
