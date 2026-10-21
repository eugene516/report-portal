-- 보안 점검(db advisors) 후속: 권한 확인 함수는 로그인 사용자 정책에서만 쓰므로 anon 실행 권한을 회수한다.
revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_staff() to authenticated;
grant  execute on function public.is_admin() to authenticated;
