-- report-capture 함수(service_role)가 광고주 링크 토큰을 검증할 수 있도록
grant execute on function public.resolve_client_token(text) to service_role;
