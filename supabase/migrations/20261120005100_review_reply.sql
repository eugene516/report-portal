-- 파일 검수: 광고주 코멘트(재검수 요청 · 이미지별 수정 요청)에 담당 직원이 답글
-- - 답글도 검수 기록(review_events, action 'reply')으로 남고, reply_to 로 원래 코멘트를 가리킨다
-- - 광고주는 기존 조회 정책으로 답글을 볼 수 있다. 쓰기는 아래 함수로만 (담당 직원 · 관리자)
alter table public.review_events add column if not exists reply_to bigint references public.review_events (id) on delete cascade;
create index if not exists review_events_reply_to_idx on public.review_events (reply_to) where reply_to is not null;

alter table public.review_events drop constraint if exists review_events_action_check;
alter table public.review_events add constraint review_events_action_check check (action in ('request', 'approve', 'changes', 'resubmit', 'edit', 'reply'));

create or replace function public.review_reply(p_event bigint, p_comment text)
returns bigint language plpgsql volatile security definer set search_path = ''
as $$
declare ev public.review_events; who text; new_id bigint;
begin
  select * into ev from public.review_events where id = p_event;
  if ev.id is null or not public.can_access_client(ev.client_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if ev.action = 'reply' or ev.comment is null then raise exception 'not a comment' using errcode = '22023'; end if;
  if nullif(btrim(p_comment), '') is null then raise exception 'comment required' using errcode = '22023'; end if;
  if length(btrim(p_comment)) > 2000 then raise exception 'too long' using errcode = '22023'; end if;
  select coalesce(display_name, email) into who from public.staff_roles where user_id = auth.uid();
  insert into public.review_events (item_id, client_id, version, action, comment, actor, actor_name, actor_kind, file_id, reply_to)
  values (ev.item_id, ev.client_id, ev.version, 'reply', btrim(p_comment), auth.uid(), who, 'staff', ev.file_id, ev.id)
  returning id into new_id;
  return new_id;
end;
$$;
revoke execute on function public.review_reply(bigint, text) from public, anon;
grant execute on function public.review_reply(bigint, text) to authenticated;
