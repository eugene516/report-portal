-- 파일 검수: 담당 직원이 등록한 콘텐츠를 상태와 관계없이 삭제 · 수정할 수 있게
-- - 콘텐츠 삭제: 작성 중뿐 아니라 검수 요청 · 완료 · 재검수 요청 상태도 (파일 · 검수 기록 함께 삭제)
-- - 파일: 지금 버전 · 다음 수정본 파일은 지우고 다시 올릴 수 있다 (이전 버전 파일은 기록으로 보존)
-- - 대상 월 · 제목 · 구분 수정은 기존 권한(update title, kind, period)으로 가능

drop policy "직원 삭제(작성 중만)" on public.review_items;
create policy "직원 삭제" on public.review_items for delete to authenticated
  using (public.can_access_client(client_id));

drop policy "직원 업로드" on public.review_files;
create policy "직원 업로드" on public.review_files for insert to authenticated
  with check (public.can_access_client(client_id) and exists (select 1 from public.review_items i where i.id = item_id and i.client_id = review_files.client_id
              and ((i.status = 'draft' and review_files.version = i.version) or (i.status <> 'draft' and review_files.version in (i.version, i.version + 1)))));

drop policy "직원 삭제(요청 전 파일만)" on public.review_files;
create policy "직원 삭제(지금 · 다음 버전)" on public.review_files for delete to authenticated
  using (public.can_access_client(client_id) and exists (select 1 from public.review_items i where i.id = item_id and review_files.version >= i.version));
