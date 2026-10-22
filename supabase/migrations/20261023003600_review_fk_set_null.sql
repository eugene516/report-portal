-- 광고주 · 직원 계정을 지워도 검수 기록(누가 · 언제)은 남도록: 계정 연결만 비운다 (이름은 actor_name 에 남아 있음)
alter table public.review_events drop constraint review_events_actor_fkey,
  add constraint review_events_actor_fkey foreign key (actor) references auth.users (id) on delete set null;
alter table public.review_items drop constraint review_items_approved_by_fkey,
  add constraint review_items_approved_by_fkey foreign key (approved_by) references auth.users (id) on delete set null;
alter table public.review_items drop constraint review_items_created_by_fkey,
  add constraint review_items_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
alter table public.review_files drop constraint review_files_uploaded_by_fkey,
  add constraint review_files_uploaded_by_fkey foreign key (uploaded_by) references auth.users (id) on delete set null;
alter table public.client_users drop constraint client_users_created_by_fkey,
  add constraint client_users_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;
