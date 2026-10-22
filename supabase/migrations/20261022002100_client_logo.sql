-- 광고주 로고 (리포트 좌측 상단의 정사각형 프로필 이미지)
-- - 저장소 logos: 공개 읽기(로고는 광고주 링크 화면에도 그대로 보여야 함), 올리기·바꾸기·지우기는 담당·관리자만
-- - 경로: {client_id}/{임의 이름}.webp — 화면에서 512×512 정사각형으로 잘라 올린다
-- - 공개 버킷이지만 목록 조회 정책이 없어 다른 광고주의 파일 이름을 알아낼 수 없다

alter table public.clients add column if not exists logo_path text
  check (logo_path is null or logo_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{8,64}\.(webp|png|jpg)$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "담당·관리자 로고 업로드" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.can_access_client(public.storage_client_of(name)));
create policy "담당·관리자 로고 수정" on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.can_access_client(public.storage_client_of(name)));
create policy "담당·관리자 로고 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.can_access_client(public.storage_client_of(name)));
-- 삭제·덮어쓰기 때 대상 확인용 (공개 주소 읽기와는 별개)
create policy "담당·관리자 로고 조회" on storage.objects for select to authenticated
  using (bucket_id = 'logos' and public.can_access_client(public.storage_client_of(name)));

-- 리포트 공통 요약에 로고 경로 추가 (나머지는 20261021000300 과 같음)
create or replace function public._client_summary(p_client uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'category', c.category, 'area', c.area, 'logo', c.logo_path,
    'channels', coalesce((
      select jsonb_object_agg(ch.channel, jsonb_build_object('contracted', ch.contracted, 'apiConnected', ch.api_connected))
        from public.client_ad_channels ch where ch.client_id = c.id), '{}'::jsonb)
  )
  from public.clients c where c.id = p_client;
$$;
revoke execute on function public._client_summary(uuid) from public, anon, authenticated;
