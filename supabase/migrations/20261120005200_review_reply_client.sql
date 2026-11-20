-- 파일 검수 답글: 광고주 계정도 답글을 남길 수 있다
-- - 직원(담당 · 관리자) 또는 그 병원의 광고주 계정 (광고주는 '작성 중'이 아닌 항목만)
-- - 답글에 다시 답하면 원래 코멘트 아래 같은 대화로 이어진다 (한 단계 대화)
create or replace function public.review_reply(p_event bigint, p_comment text)
returns bigint language plpgsql volatile security definer set search_path = ''
as $$
declare ev public.review_events; st text; who text; kind text; new_id bigint;
begin
  select * into ev from public.review_events where id = p_event;
  if ev.id is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if ev.action = 'reply' then select * into ev from public.review_events where id = ev.reply_to; end if;   -- 대화의 맨 위 코멘트로
  if ev.id is null or ev.comment is null then raise exception 'not a comment' using errcode = '22023'; end if;
  if public.can_access_client(ev.client_id) then
    kind := 'staff';
    select coalesce(display_name, email) into who from public.staff_roles where user_id = auth.uid();
  elsif public.is_client_user(ev.client_id) then
    select status into st from public.review_items where id = ev.item_id;
    if st is null or st = 'draft' then raise exception 'forbidden' using errcode = '42501'; end if;
    kind := 'client';
    select coalesce(name, email) into who from public.client_users where user_id = auth.uid();
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(p_comment), '') is null then raise exception 'comment required' using errcode = '22023'; end if;
  if length(btrim(p_comment)) > 2000 then raise exception 'too long' using errcode = '22023'; end if;
  insert into public.review_events (item_id, client_id, version, action, comment, actor, actor_name, actor_kind, file_id, reply_to)
  values (ev.item_id, ev.client_id, ev.version, 'reply', btrim(p_comment), auth.uid(), who, kind, ev.file_id, ev.id)
  returning id into new_id;
  return new_id;
end;
$$;
revoke execute on function public.review_reply(bigint, text) from public, anon;
grant execute on function public.review_reply(bigint, text) to authenticated;
