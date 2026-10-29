-- 광고주 링크 화면 '견적서' 메뉴: 등록된 견적서 · 계약서 목록 (파일 경로는 넘기지 않는다, 열람은 report-quote 함수가 토큰 확인 후 서명 주소로 보낸다)
create or replace function public.report_quotes(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := public.resolve_client_token(p_token);
begin
  if v is null then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'period', q.period, 'kind', q.kind, 'fileName', q.file_name,
                                                       'mime', q.mime_type, 'size', q.size_bytes, 'createdAt', q.created_at)
                                    order by q.period desc nulls last, q.created_at desc)
                    from public.client_quotes q where q.client_id = v), '[]'::jsonb);
end;
$$;
revoke execute on function public.report_quotes(text) from public;
grant execute on function public.report_quotes(text) to anon, authenticated;
