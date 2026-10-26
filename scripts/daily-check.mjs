// 매일 오전 9시 지표 점검 (ego-browser) — 이 PC가 켜져 있고 ego 브라우저에 리포트 포털이 로그인되어 있어야 한다
//   1) DB 에서 이번 달 점검 대상을 모은다: 블로그 원고 · 플레이스 키워드 · 카페/당근 게시글(이번 달·지난달 게시중)
//   2) ego-browser 로 네이버 검색 · 게시글 · 리포트 포털 화면을 확인한다 (scripts/daily-check-round.mjs)
//   3) 결과를 DB 에 저장한다: blog_rank_results · place_rank_results · cafe_posts(삭제 여부 · 현재 조회/댓글)
//   4) 기록: G:\공유 드라이브\15. 회사 자체 PJT\report-portal\collection-scripts\daily-check\{날짜}\ (입력 · 결과 · 요약)
// 실행: node scripts/daily-check.mjs            (예약: Windows 작업 "ReportPortal-DailyCheck" 매일 09:00, scripts/schedule-tasks.ps1)
//       node scripts/daily-check.mjs --dry      (대상만 확인, 브라우저 실행 · 저장 안 함)
// 네이버 광고 성과는 Supabase 예약 작업(매일 09:00)이 따로 수집한다.
import { execFileSync, execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { APP, json, kst, kstDate, sql } from "./lib/db.mjs";
import { blogPostsThisMonth, keywordFromTitle, roundKey } from "./lib/channels.mjs";

const SITE = "https://report-portal-rho.vercel.app";
const ROOT = "G:\\공유 드라이브\\15. 회사 자체 PJT\\report-portal\\collection-scripts\\daily-check";
const day = kstDate();
const dir = join(ROOT, day);
mkdirSync(dir, { recursive: true });
const log = (m) => { const line = `[${kst().toISOString().slice(11, 19)}] ${m}`; console.log(line); appendFileSync(join(dir, "summary.txt"), line + "\n", "utf8"); };
const period = day.slice(0, 7);
// period · prevPeriod 는 이 스크립트가 만든 YYYY-MM 값이라 SQL 에 바로 넣는다
const prevPeriod = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);

// 0) 자동 수집 채널 · 블로그 새 글 (RSS, 브라우저 없이) ---------------------------------------
const sources = sql(`select s.client_id as client, s.kind, s.url, c.name from public.client_sources s join public.clients c on c.id = s.client_id order by c.name, s.kind`);
for (const s of sources.filter((x) => x.kind === "blog")) {
  try {
    const posts = await blogPostsThisMonth(s.url, period);
    // 이미 등록된 글(주소의 글 번호가 같은 글)은 건너뛴다. 이번 달 글이 없으면 아무것도 넣지 않는다
    const added = sql(`
      insert into public.blog_posts (client_id, period, keyword, title, url, post_type, published_on, sort)
      select '${s.client}'::uuid, '${period}', x->>'keyword', x->>'title', x->>'url', '일반', (x->>'publishedOn')::date, 100 + (row_number() over (order by x->>'publishedOn'))::int
        from jsonb_array_elements(${json(posts.map((p) => ({ ...p, keyword: keywordFromTitle(p.title) })))}) x
       where not exists (select 1 from public.blog_posts b where b.client_id = '${s.client}'::uuid and b.url ~ ('/' || (x->>'postId') || '($|[/?#])'))
      returning id`);
    log(`${s.name} 블로그: 이번 달 글 ${posts.length}개 · 새로 등록 ${added.length}개`);
  } catch (e) { log(`${s.name} 블로그 RSS 오류: ${String(e).slice(0, 120)}`); }
}

// 1) 대상 ---------------------------------------------------------------------------------
const blog = sql(`select b.client_id as client, b.keyword, b.url from public.blog_posts b where b.period = '${period}' order by b.client_id, b.sort`)
  .map((b) => { const m = b.url.match(/blog\.naver\.com\/([^/?#]+)\/(\d+)/); return m ? { ...b, account: m[1], post: m[2] } : null; })
  .filter(Boolean);
const place = sql(`select k.client_id as client, k.keyword, c.name as "placeName",
                           row_number() over (partition by k.client_id order by k.important desc, k.sort, k.keyword) as idx
                      from public.tracked_keywords k join public.clients c on c.id = k.client_id
                     where k.kind = 'place' and k.active order by c.name, idx`);
const cafe = sql(`select p.id, p.url from public.cafe_posts p where p.status = '게시중' and p.period in ('${period}', '${prevPeriod}') order by p.posted_on`);
const first = sql(`select id from public.clients order by name limit 1`)[0];
const portal = [["대시보드", "/admin"], ["광고주 현황", "/admin/clients"], ["업무 확인", "/admin/tasks"], ...(first ? [["광고주 리포트", `/admin/clients/${first.id}`]] : [])];
const captureDir = join(dir, "captures").replace(/\\/g, "/");
mkdirSync(captureDir, { recursive: true });
// --only=place 처럼 일부만 다시 확인할 수 있다 (blog · place · cafe · channels · portal)
const only = process.argv.find((x) => x.startsWith("--only="))?.slice(7).split(",");
const pick = (k, v) => (!only || only.includes(k) ? v : []);
const job = { site: SITE, period, blog: pick("blog", blog), place: pick("place", place), cafe: pick("cafe", cafe), portal: pick("portal", portal), captureDir, sources: pick("channels", sources.filter((x) => x.kind !== "blog")) };
const input = join(dir, "input.json"), output = join(dir, "result.json");
writeFileSync(input, JSON.stringify(job, null, 1), "utf8");
log(`대상: 블로그 ${blog.length} · 플레이스 ${place.length} · 게시글 ${cafe.length} · 화면 ${portal.length}`);
if (process.argv.includes("--dry")) process.exit(0);

// 2) ego-browser 실행 ----------------------------------------------------------------------
const launcher = join(dir, "run.mjs");
writeFileSync(launcher, `globalThis.__RP_CHECK = ${JSON.stringify({ input, output })};\nawait import(${JSON.stringify(pathToFileURL(join(APP, "scripts/daily-check-round.mjs")).href)});\n`, "utf8");
try {
  // ego-browser 는 .cmd 라 셸로 실행한다. 경로는 URL 인코딩되어 공백·따옴표가 없다
  const out = execSync(`ego-browser nodejs -e "await import('${pathToFileURL(launcher).href}')"`, { encoding: "utf8", timeout: 50 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  log(out.trim().split(/\r?\n/).filter((l) => l.trim()).slice(-1)[0] ?? "");
} catch (e) {
  log(`브라우저 점검 중단: ${String(e.message ?? e).slice(0, 300)}`);
}
if (!existsSync(output)) { log("결과 파일이 없어 저장을 건너뜁니다."); process.exit(1); }
const r = JSON.parse(readFileSync(output, "utf8"));

// 3) 저장 ----------------------------------------------------------------------------------
if (r.blog?.length) sql(`
  insert into public.blog_rank_results (client_id, keyword, post_url, main_rank, blog_tab_rank, main_other, tab_other, collected_at, method)
  select (x->>'client')::uuid, x->>'keyword', x->>'url', (x->>'main')::int, (x->>'blogTab')::int, x->'mainOther', x->'tabOther', (x->>'at')::timestamptz, 'ego-browser 매일 점검'
    from jsonb_array_elements(${json(r.blog)}) x`);
// 플레이스 캡쳐 → 비공개 저장소 captures/{광고주}/place/{시각}/{번호}.jpg (CLI 로그인으로 업로드)
const stampDir = kst().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
const upload = (file, dest) => execFileSync(process.execPath, [join(APP, "node_modules/supabase/dist/supabase.js"), "storage", "cp", "--linked", "--experimental", "--workdir", APP, "--content-type", "image/jpeg", "./" + basename(file), `ss:///captures/${dest}`], { cwd: dirname(file), stdio: "ignore" });
for (const p of r.place ?? []) {
  p.adCapturePath = null;
  if (p.adCapture && existsSync(p.adCapture)) {
    const dest = `${p.client}/place-ad/${stampDir}/${String(p.idx).padStart(2, "0")}.jpg`;
    try { upload(p.adCapture, dest); p.adCapturePath = dest; } catch { log(`광고 캡쳐 업로드 실패: ${p.keyword}`); }
  }
  if (!p.capture || !existsSync(p.capture)) { p.capturePath = null; continue; }
  const dest = `${p.client}/place/${stampDir}/${String(p.idx).padStart(2, "0")}.jpg`;
  try {
    // 원본은 상대 경로로 넘긴다 (CLI 가 "G:" 같은 드라이브 문자를 원격 주소로 오해함)
    execFileSync(process.execPath, [join(APP, "node_modules/supabase/dist/supabase.js"), "storage", "cp", "--linked", "--experimental", "--workdir", APP, "--content-type", "image/jpeg", "./" + basename(p.capture), `ss:///captures/${dest}`], { cwd: dirname(p.capture), stdio: "ignore" });
    p.capturePath = dest;
  } catch { p.capturePath = null; log(`캡쳐 업로드 실패: ${p.keyword}`); }
}
if (r.place?.length) sql(`
  insert into public.place_rank_results (client_id, keyword, rank, ad_rank, page, capture_path, ad_capture_path, collected_at, method)
  select (x->>'client')::uuid, x->>'keyword', (x->>'rank')::int, (x->>'adRank')::int, (x->>'page')::int, x->>'capturePath', x->>'adCapturePath', (x->>'at')::timestamptz, 'ego-browser 매일 점검'
    from jsonb_array_elements(${json(r.place.filter((p) => !p.noBlock))}) x`);
if (r.cafe?.length) sql(`
  update public.cafe_posts p
     set status = case when (x->>'deleted')::boolean then '삭제됨' else p.status end,
         current_views = coalesce((x->>'views')::int, p.current_views),
         current_comments = coalesce((x->>'comments')::int, p.current_comments),
         checked_at = (x->>'at')::timestamptz
    from jsonb_array_elements(${json(r.cafe)}) x
   where p.id = (x->>'id')::uuid`);

// 홈페이지 칼럼: 이번 달 글 중 아직 없는 것만 (주소의 idx 로 비교)
if (r.columns?.length) {
  const n = sql(`
    insert into public.web_columns (client_id, period, title, url, published_on, sort)
    select (x->>'client')::uuid, '${period}', x->>'title', x->>'url', (x->>'date')::date, 100 + (row_number() over (order by x->>'date'))::int
      from jsonb_array_elements(${json(r.columns)}) x
     where not exists (select 1 from public.web_columns w where w.client_id = (x->>'client')::uuid and substring(w.url from 'idx=(\\d+)') = substring(x->>'url' from 'idx=(\\d+)'))
    returning id`).length;
  log(`홈페이지 칼럼: 이번 달 ${r.columns.length}개 · 새로 등록 ${n}개`);
}
// SNS 소식 → 카드뉴스 회차 (같은 제목이면 한 회차, 채널별 링크). 이미 있는 링크는 건너뛴다
if (r.sns?.length) {
  const groups = new Map();
  for (const p of r.sns) {
    const key = `${p.client}|${roundKey(p.title) || p.url}`;
    const g = groups.get(key) ?? { client: p.client, key: roundKey(p.title) || p.url, title: p.title, date: p.date, links: [] };
    if (p.date < g.date) g.date = p.date;
    if (p.media === "인스타그램" || !g.title) g.title = p.title || g.title;
    g.links.push({ media: p.media, url: p.url });
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
  sql(`
    do $do$
    declare g jsonb; v_round uuid; v_no int;
    begin
      for g in select * from jsonb_array_elements(${json(list)}) loop
        select id into v_round from public.cardnews_rounds
         where client_id = (g->>'client')::uuid and period = '${period}'
           and (auto_key = g->>'key' or exists (select 1 from public.cardnews_links l, jsonb_array_elements(g->'links') k where l.round_id = cardnews_rounds.id and l.url = k->>'url'))
         limit 1;
        if v_round is null then
          select coalesce(max(round_no), 0) + 1 into v_no from public.cardnews_rounds where client_id = (g->>'client')::uuid and period = '${period}';
          insert into public.cardnews_rounds (client_id, period, round_no, posted_on, topic, auto_key)
          values ((g->>'client')::uuid, '${period}', v_no, (g->>'date')::date, nullif(g->>'title', ''), g->>'key') returning id into v_round;
        end if;
        insert into public.cardnews_links (round_id, client_id, media, url)
        select v_round, (g->>'client')::uuid, k->>'media', k->>'url' from jsonb_array_elements(g->'links') k
         where not exists (select 1 from public.cardnews_links l where l.client_id = (g->>'client')::uuid and l.url = k->>'url');
      end loop;
    end $do$`);
  log(`SNS 소식: 이번 달 게시물 ${r.sns.length}개 · 회차 ${list.length}개로 정리`);
}

// 4) 요약 ----------------------------------------------------------------------------------
const deleted = (r.cafe ?? []).filter((c) => c.deleted).length;
const ranked = (r.blog ?? []).filter((b) => b.main != null || b.blogTab != null).length;
const shownPlace = (r.place ?? []).filter((p) => p.rank != null).length;   // 정상 노출 키워드 수
const shots = (r.place ?? []).filter((p) => p.capturePath).length;
const adShots = (r.place ?? []).filter((p) => p.adCapturePath).length;
log(`저장: 블로그 ${r.blog?.length ?? 0}건(노출 ${ranked}) · 플레이스 ${r.place?.length ?? 0}건(정상 노출 ${shownPlace} · 캡쳐 ${shots} · 광고 노출 캡쳐 ${adShots}) · 게시글 ${r.cafe?.length ?? 0}건(삭제 감지 ${deleted})`);
for (const p of r.portal ?? []) log(`화면 ${p.name}: ${p.ok ? "정상" : `확인 필요 (${p.note})`}`);
for (const e of r.errors ?? []) log(`오류: ${e}`);
if (r.portal?.some((p) => p.note === "로그인이 풀려 있음")) log("※ ego 브라우저에서 리포트 포털에 다시 로그인해 주세요.");
