-- 업무관리 · 문의관리 (영업 문의 카드)
-- 1) inquiry_settings          : 문의 채널 · 관심 서비스 · 미계약 사유 · 단계별 기준일(SLA). 한 줄짜리 설정 (id = 1)
-- 2) inquiries                 : 문의 카드. 단계(stage) · 담당(owner) · 다음 액션 · 계약/미계약/대기/보류 정보
-- 3) inquiry_events            : 상담 이력(메모 · 전화 · 메일 · 카톡 · 미팅 · AI · 단계 이동)
-- 4) inquiry_monthly_summaries : AI 월간 요약 (inquiry-ai 함수가 서비스 롤로만 저장)
-- 권한
--   * 직원이면 누구나 모든 문의를 보고, 새 문의를 등록하고, 기본 정보 · 다음 액션 · 상담 이력을 기록한다.
--   * 단계 변경 · 담당 변경 · 계약/미계약/대기/보류 정보는 그 문의의 담당(owner) 또는 관리자만 (트리거가 확인).
--     담당이 비어 있는 문의는 직원 누구나 담당을 정할 수 있다.
--   * 문의 삭제는 담당 또는 관리자, 설정 변경은 관리자만.
-- 날짜는 모두 한국시간 기준 date 로 저장한다 (접수일 · 마지막 기록일 · 단계 변경일).

-- 1) 설정 ------------------------------------------------------------------------------------------
create table public.inquiry_settings (
  id            int primary key default 1 check (id = 1),
  channels      text[] not null default '{}',
  services      text[] not null default '{}',
  lost_reasons  text[] not null default '{}',
  sla           jsonb  not null default '{}'::jsonb,     -- {"inquiry":1,"responding":3,"meeting":7,"proposal":7} (일)
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null
);

insert into public.inquiry_settings (id, channels, services, lost_reasons, sla) values (
  1,
  array['홈페이지', '세미나·강의', '지인', '소개', 'BNI', '기타'],
  array['마케팅 대행', '병원 마케팅', '영상 제작', '사업화 컨설팅', '홈페이지 제작', '강의', '기타'],
  array['예산 불일치', '경쟁사 선택', '연락 두절', '시기 미정', '자체 진행', '서비스 불일치', '기타'],
  '{"inquiry": 1, "responding": 3, "meeting": 7, "proposal": 7}'::jsonb
) on conflict (id) do nothing;

-- 2) 문의 카드 ----------------------------------------------------------------------------------------
create table public.inquiries (
  id                uuid primary key default gen_random_uuid(),
  no                bigint generated always as identity,        -- 화면 표시용 번호 (L001)
  company           text not null check (length(btrim(company)) between 1 and 100),
  person            text check (person is null or length(person) <= 100),
  phone             text check (phone is null or length(phone) <= 40),
  email             text check (email is null or length(email) <= 200),
  channel           text check (channel is null or length(channel) <= 40),
  referrer          text check (referrer is null or length(referrer) <= 100),
  services          text[] not null default '{}',
  budget            text check (budget is null or length(budget) <= 100),
  industry          text check (industry is null or length(industry) <= 60),
  region            text check (region is null or length(region) <= 60),
  summary           text check (summary is null or length(summary) <= 4000),
  raw               text check (raw is null or length(raw) <= 20000),   -- 문의 원문
  stage             text not null default 'inquiry'
                    check (stage in ('inquiry', 'responding', 'meeting', 'proposal', 'waiting', 'hold', 'won', 'lost')),
  owner             uuid references auth.users (id) on delete set null,  -- 담당 직원
  received_on       date not null default (now() at time zone 'Asia/Seoul')::date,  -- 접수일
  stage_changed_on  date not null default (now() at time zone 'Asia/Seoul')::date,
  last_activity_on  date not null default (now() at time zone 'Asia/Seoul')::date,  -- 마지막 상담 기록일
  next_action_text  text check (next_action_text is null or length(next_action_text) <= 300),
  next_action_on    date,
  contract_on       date,
  contract_type     text check (contract_type is null or contract_type in ('매월', '단기')),
  contract_service  text check (contract_service is null or length(contract_service) <= 200),
  lost_reason       text check (lost_reason is null or length(lost_reason) <= 40),
  lost_memo         text check (lost_memo is null or length(lost_memo) <= 2000),
  wait_until        date,
  wait_memo         text check (wait_memo is null or length(wait_memo) <= 2000),
  hold_until        date,
  hold_memo         text check (hold_memo is null or length(hold_memo) <= 2000),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.inquiries (stage);
create index on public.inquiries (owner);
create index on public.inquiries (received_on);

-- 3) 상담 이력 ----------------------------------------------------------------------------------------
create table public.inquiry_events (
  id          uuid primary key default gen_random_uuid(),
  inquiry_id  uuid not null references public.inquiries (id) on delete cascade,
  kind        text not null check (kind in ('memo', 'call', 'mail', 'kakao', 'meeting', 'ai', 'stage')),
  body        text not null check (length(btrim(body)) between 1 and 8000),
  author      uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.inquiry_events (inquiry_id, created_at);

-- 4) AI 월간 요약 -------------------------------------------------------------------------------------
create table public.inquiry_monthly_summaries (
  id          uuid primary key default gen_random_uuid(),
  period      text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$' or period = 'recent3'),   -- 'YYYY-MM' 또는 최근 3개월
  body        text not null check (length(body) <= 8000),
  stats       jsonb not null default '{}'::jsonb,      -- 요약에 쓴 집계 숫자 (원문·개인정보 없음)
  model       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index on public.inquiry_monthly_summaries (period, created_at desc);

-- 단계 이름 (상담 이력 문구용)
create or replace function public.inquiry_stage_name(p_stage text)
returns text language sql immutable set search_path = ''
as $$
  select case p_stage when 'inquiry' then '문의' when 'responding' then '요청 대응중' when 'meeting' then '미팅'
                      when 'proposal' then '제안·견적' when 'waiting' then '대기' when 'hold' then '보류'
                      when 'won' then '계약' when 'lost' then '미계약' else p_stage end;
$$;

-- 저장 전 확인: 권한(담당·관리자만 단계/계약 처리) + 단계 이동 시 기본값
create or replace function public._inquiry_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_uid, new.created_by);
    new.stage_changed_on := v_today;
    new.last_activity_on := v_today;
    new.updated_at := now();
    return new;
  end if;

  -- 담당이 아니고 관리자도 아니면 단계 · 담당 · 계약/미계약/대기/보류 정보는 바꿀 수 없다 (담당 미정 카드는 예외)
  if v_uid is not null and old.owner is not null and old.owner <> v_uid and not public.is_admin() then
    if new.stage is distinct from old.stage or new.owner is distinct from old.owner
       or row(new.contract_on, new.contract_type, new.contract_service, new.lost_reason, new.lost_memo,
              new.wait_until, new.wait_memo, new.hold_until, new.hold_memo)
          is distinct from
          row(old.contract_on, old.contract_type, old.contract_service, old.lost_reason, old.lost_memo,
              old.wait_until, old.wait_memo, old.hold_until, old.hold_memo) then
      raise exception '담당자 또는 관리자만 단계 · 담당 · 계약 정보를 바꿀 수 있습니다.' using errcode = '42501';
    end if;
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if new.stage is distinct from old.stage then
    new.stage_changed_on := v_today;
    new.last_activity_on := v_today;
    if new.stage = 'won' then
      new.contract_on := coalesce(new.contract_on, v_today);
      new.contract_type := coalesce(new.contract_type, '매월');
      new.contract_service := coalesce(new.contract_service, new.services[1]);
    elsif new.stage = 'lost' then
      new.lost_reason := coalesce(new.lost_reason, (select s.lost_reasons[1] from public.inquiry_settings s where s.id = 1));
    elsif new.stage = 'hold' and (new.hold_until is null or new.hold_until < v_today) then
      new.hold_until := v_today + 14;
    elsif new.stage = 'waiting' and (new.wait_until is null or new.wait_until < v_today) then
      new.wait_until := v_today + 7;
    end if;
    -- 대기 · 보류 · 계약 · 미계약으로 빠지면 다음 액션은 비운다 (확인일 · 재접촉일이 대신한다)
    if new.stage in ('won', 'lost', 'hold', 'waiting') then
      new.next_action_text := null;
      new.next_action_on := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger inquiries_guard before insert or update on public.inquiries
  for each row execute function public._inquiry_guard();

-- 저장 후: 접수 · 단계 이동을 상담 이력에 남긴다
create or replace function public._inquiry_stage_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.inquiry_events (inquiry_id, kind, body, author)
    values (new.id, 'stage',
            '문의 접수' || case when new.channel is not null then ' (' || new.channel || coalesce(' · ' || nullif(new.referrer, ''), '') || ')' else '' end,
            coalesce(auth.uid(), new.created_by));
  elsif new.stage is distinct from old.stage then
    insert into public.inquiry_events (inquiry_id, kind, body, author)
    values (new.id, 'stage',
            public.inquiry_stage_name(new.stage) || ' 단계로 이동'
              || case when new.stage = 'lost' and new.lost_reason is not null then ' (' || new.lost_reason || ')' else '' end,
            auth.uid());
  end if;
  return null;
end;
$$;
create trigger inquiries_stage_event after insert or update of stage on public.inquiries
  for each row execute function public._inquiry_stage_event();

-- 상담 기록(메모 · 전화 · 메일 · 카톡 · 미팅)을 남기면 마지막 기록일을 갱신한다
create or replace function public._inquiry_touch()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_day date := (new.created_at at time zone 'Asia/Seoul')::date;
begin
  if new.kind in ('memo', 'call', 'mail', 'kakao', 'meeting') then
    update public.inquiries set last_activity_on = v_day
     where id = new.inquiry_id and last_activity_on < v_day;
  end if;
  return null;
end;
$$;
create trigger inquiry_events_touch after insert on public.inquiry_events
  for each row execute function public._inquiry_touch();

revoke execute on function public._inquiry_guard()       from public, anon, authenticated;
revoke execute on function public._inquiry_stage_event() from public, anon, authenticated;
revoke execute on function public._inquiry_touch()       from public, anon, authenticated;

-- 계정 목록(설정 화면): 직원 이름 · 이메일 · 역할 (직원 누구나 조회)
create or replace function public.inquiry_staff()
returns table (id uuid, name text, email text, role text, job_title text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select r.user_id, coalesce(r.display_name, split_part(r.email, '@', 1)), r.email, r.role, r.job_title
                 from public.staff_roles r
                order by public.job_rank(r.job_title), case r.role when 'owner' then 0 when 'admin' then 1 else 2 end, 2;
end;
$$;
revoke execute on function public.inquiry_staff() from public, anon;
grant  execute on function public.inquiry_staff() to authenticated;

-- 권한 · RLS ------------------------------------------------------------------------------------------
alter table public.inquiry_settings          enable row level security;
alter table public.inquiries                 enable row level security;
alter table public.inquiry_events            enable row level security;
alter table public.inquiry_monthly_summaries enable row level security;

revoke all on public.inquiry_settings, public.inquiries, public.inquiry_events, public.inquiry_monthly_summaries from anon;
revoke all on public.inquiry_settings, public.inquiries, public.inquiry_events, public.inquiry_monthly_summaries from authenticated;
grant select, update                 on public.inquiry_settings          to authenticated;   -- 수정은 정책상 관리자만
grant select, insert, update, delete on public.inquiries                 to authenticated;
grant select, insert, delete         on public.inquiry_events            to authenticated;
grant select                         on public.inquiry_monthly_summaries to authenticated;   -- 저장은 inquiry-ai 함수(서비스 롤)만
grant select, insert, update, delete on public.inquiry_settings, public.inquiries, public.inquiry_events, public.inquiry_monthly_summaries to service_role;

create policy "직원 설정 조회"   on public.inquiry_settings for select to authenticated using (public.is_staff());
create policy "관리자 설정 수정" on public.inquiry_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "직원 문의 조회" on public.inquiries for select to authenticated using (public.is_staff());
create policy "직원 문의 등록" on public.inquiries for insert to authenticated with check (public.is_staff());
-- 단계 · 담당 · 계약 정보는 트리거(_inquiry_guard)가 담당·관리자인지 다시 확인한다
create policy "직원 문의 수정" on public.inquiries for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "담당·관리자 문의 삭제" on public.inquiries for delete to authenticated
  using (public.is_admin() or (public.is_staff() and owner = auth.uid()));

create policy "직원 이력 조회" on public.inquiry_events for select to authenticated using (public.is_staff());
create policy "직원 이력 기록" on public.inquiry_events for insert to authenticated
  with check (public.is_staff() and author = auth.uid() and kind <> 'stage');
create policy "본인·관리자 이력 삭제" on public.inquiry_events for delete to authenticated
  using (kind <> 'stage' and (public.is_admin() or (public.is_staff() and author = auth.uid())));

create policy "직원 월간 요약 조회" on public.inquiry_monthly_summaries for select to authenticated using (public.is_staff());

-- 실시간 반영 -----------------------------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.inquiries; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.inquiry_events; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.inquiry_settings; exception when duplicate_object then null; end;
end $$;
