-- 수집 작업(service_role)만 실행 잠금 함수를 쓸 수 있게 한다 (앞서 public 실행 권한을 회수했기 때문)
grant execute on function public.acquire_sync_lock(text, uuid, int) to service_role;
grant execute on function public.release_sync_lock(text, uuid)      to service_role;
