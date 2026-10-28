-- 파일 검수: 구분에 '주제 · 키워드'(keyword) 추가, 검수 파일에 엑셀(xlsx · xls · csv) 허용
-- 1) 구분
alter table public.review_items drop constraint review_items_kind_check;
alter table public.review_items add constraint review_items_kind_check check (kind in ('keyword', 'blog', 'column', 'cardnews', 'etc'));

-- 2) 저장소 허용 형식에 엑셀 추가 (기존 형식 유지)
update storage.buckets
   set allowed_mime_types = array['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
        'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/x-hwp', 'application/haansofthwp', 'text/plain',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv']
 where id = 'reviews';

-- 3) 검수 현황 요약: 주제 · 키워드를 맨 앞에
create or replace function public._review_summary(p_client uuid, p_period text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'pending', (select count(*) from public.review_items where client_id = p_client and status = 'pending'),
    'kinds', coalesce((
      select jsonb_agg(jsonb_build_object('kind', k.kind, 'requested', k.requested, 'approved', k.approved,
                                          'target', greatest(k.requested, coalesce(q.qty, 0))) order by array_position(array['keyword','blog','column','cardnews','etc'], k.kind))
        from (select kind, count(*) filter (where status <> 'draft') requested, count(*) filter (where status = 'approved') approved
                from public.review_items where client_id = p_client and period = p_period group by kind) k
        left join (select service, sum(quantity) qty from public.client_contract_items
                    where client_id = p_client and period = p_period group by service) q on q.service = k.kind
       where k.requested > 0), '[]'::jsonb));
$$;
revoke execute on function public._review_summary(uuid, text) from public, anon, authenticated;
