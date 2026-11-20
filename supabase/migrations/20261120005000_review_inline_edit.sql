-- 파일 검수: 블로그 · 칼럼 Word 원고를 화면에서 바로 수정
-- - 저장은 review-edit 함수(서비스 롤)만 한다: 직원(담당 · 관리자)은 검수 완료 전까지, 광고주 계정은 검수 대기 중인 지금 버전만
-- - 수정한 글자는 Word 파일 안에서 노란 형광 + 빨간 글씨(문자 스타일 '검수수정')로 남는다
-- - 처음 올린 원본은 original_path 로 보관한다 (지우지 않음)
alter table public.review_files
  add column if not exists original_path  text,
  add column if not exists edited_at      timestamptz,
  add column if not exists edited_by_name text,
  add column if not exists edit_count     int not null default 0;

alter table public.review_events drop constraint if exists review_events_action_check;
alter table public.review_events add constraint review_events_action_check check (action in ('request', 'approve', 'changes', 'resubmit', 'edit'));

-- 저장소: 원본(original_path)도 기록이 남아 있는 동안은 지울 수 없고, 광고주도 볼 수 있다
drop policy if exists "검수 파일 직원 삭제" on storage.objects;
create policy "검수 파일 직원 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'reviews' and public.can_access_client(public.storage_client_of(name))
         and not exists (select 1 from public.review_files f where f.storage_path = name or f.original_path = name));
drop policy if exists "검수 파일 조회" on storage.objects;
create policy "검수 파일 조회" on storage.objects for select to authenticated
  using (bucket_id = 'reviews' and (public.can_access_client(public.storage_client_of(name))
         or (public.is_client_user(public.storage_client_of(name))
             and exists (select 1 from public.review_files f join public.review_items i on i.id = f.item_id
                          where (f.storage_path = name or f.original_path = name) and i.status <> 'draft'))));
