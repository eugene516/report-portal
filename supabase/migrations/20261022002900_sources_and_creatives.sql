-- 자동 수집 채널 · 광고 소재
-- - client_sources: 광고주별로 매일 9시 점검이 확인할 채널 주소
--     blog(네이버 블로그) · column(홈페이지 칼럼 게시판) · instagram · kakao(카카오 채널 소식) · daangn(당근 비즈프로필 소식)
-- - ad_creatives: 집행 중인 광고 소재 이미지 (비공개 저장소 captures/{client}/creative/...). 광고 화면 맨 위에 보여준다
-- - cardnews_rounds.auto_key: 자동 수집한 회차를 다시 찾기 위한 제목 키 (같은 소식이 세 채널에 올라가면 한 회차)

create table public.client_sources (
  client_id   uuid not null references public.clients (id) on delete cascade,
  kind        text not null check (kind in ('blog', 'column', 'instagram', 'kakao', 'daangn')),
  url         text not null check (url ~ '^https://'),
  updated_at  timestamptz not null default now(),
  primary key (client_id, kind)
);
alter table public.client_sources enable row level security;
revoke all on public.client_sources from anon;
grant select, insert, update, delete on public.client_sources to authenticated;
grant all on public.client_sources to service_role;
create policy "담당·관리자 접근" on public.client_sources for all to authenticated
  using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));

create table public.ad_creatives (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  channel       text not null check (channel in ('naver', 'daangn', 'kakao')),
  title         text check (title is null or length(title) <= 80),
  storage_path  text not null unique,
  active        boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id)
);
create index on public.ad_creatives (client_id, channel, active);
alter table public.ad_creatives enable row level security;
revoke all on public.ad_creatives from anon;
grant select, insert, update, delete on public.ad_creatives to authenticated;
grant all on public.ad_creatives to service_role;
create policy "담당·관리자 접근" on public.ad_creatives for all to authenticated
  using (public.can_access_client(client_id)) with check (public.can_access_client(client_id));

-- 광고주 링크 화면용: 집행 중인 소재 목록 (경로만, 이미지는 report-capture 함수가 토큰을 확인한 뒤 내려준다)
create or replace function public._ad_creatives(p_client uuid, p_channel text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'path', a.storage_path) order by a.sort, a.created_at desc), '[]'::jsonb)
    from public.ad_creatives a where a.client_id = p_client and a.channel = p_channel and a.active;
$$;
revoke execute on function public._ad_creatives(uuid, text) from public, anon, authenticated;
create or replace function public.report_ad_creatives(p_token text, p_channel text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := public.resolve_client_token(p_token);
begin
  if v is null then return '[]'::jsonb; end if;
  return public._ad_creatives(v, p_channel);
end;
$$;
revoke execute on function public.report_ad_creatives(text, text) from public;
grant  execute on function public.report_ad_creatives(text, text) to anon, authenticated;

alter table public.cardnews_rounds add column if not exists auto_key text;

-- 변경 이력 대상에 추가
create trigger client_sources_log after insert or update or delete on public.client_sources for each row execute function public._log_change();
create trigger ad_creatives_log after insert or update or delete on public.ad_creatives for each row execute function public._log_change();

-- 서울청명안과 채널
insert into public.client_sources (client_id, kind, url)
select c.id, s.kind, s.url from public.clients c,
  (values ('blog', 'https://blog.naver.com/aniswells'),
          ('column', 'https://cmeyeclinic.co.kr/column/'),
          ('instagram', 'https://www.instagram.com/cmeyeclinic/'),
          ('kakao', 'https://pf.kakao.com/_XxbJzX/posts'),
          ('daangn', 'https://www.daangn.com/kr/local-profile/%EC%84%9C%EC%9A%B8%EC%B2%AD%EB%AA%85%EC%95%88%EA%B3%BC%EC%9D%98%EC%9B%90-6aq7zooi84pq/')) s(kind, url)
 where c.name = '서울청명안과'
on conflict (client_id, kind) do update set url = excluded.url, updated_at = now();
