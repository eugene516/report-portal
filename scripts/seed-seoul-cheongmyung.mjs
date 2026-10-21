// 서울청명안과 샘플(G: report-portal/prototype/seoul-cheongmyung_2026-05) → DB · 비공개 저장소 이전
// 실행: node scripts/seed-seoul-cheongmyung.mjs  (supabase CLI 로그인·link 필요)
// - 기존 이전분을 지우고 다시 넣는다 (같은 광고주의 콘텐츠 테이블만)
// - 캡쳐는 captures/{client_id}/{place|cafe}/{수집시각}/{번호}.jpg 로 올린다
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";

const SRC = "G:/공유 드라이브/15. 회사 자체 PJT/report-portal/prototype/seoul-cheongmyung_2026-05";
// 셸을 거치지 않고 supabase CLI(자바스크립트)를 node 로 직접 실행한다 (Windows 셸이 SQL 인자를 띄어쓰기로 쪼개는 문제 방지)
const SB_CLI = join(process.cwd(), "node_modules", "supabase", "dist", "supabase.js");
const sb = (args) => execFileSync(process.execPath, [SB_CLI, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

function load(file, name) {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(join(SRC, file), "utf8"), ctx);
  return ctx.window[name];
}
const R = load("report-data.js", "REPORT");
const RANKS = load("rank-results.js", "RANK_RESULTS");

const q = (v) => (v === null || v === undefined ? "null" : `$q$${String(v)}$q$`);
const n = (v) => (v === null || v === undefined || v === "" ? "null" : Number(v));
const j = (v) => (v ? `$q$${JSON.stringify(v)}$q$::jsonb` : "null");

const clientId = JSON.parse(sb(["db", "query", "--linked", "select id from public.clients where slug = 'seoul-cheongmyung'"]).replace(/^[^{]*/, "")).rows[0].id;
console.log("client", clientId);

const blogRun = RANKS.runs.find((r) => r.blog?.length);
const placeRun = RANKS.runs.find((r) => r.place?.length);
const placeStamp = placeRun.collectedAt.slice(0, 16).replace("T", "_").replace(":", "");
const cafeStamp = (R.cafe.items.find((x) => x.checkedAt)?.checkedAt ?? "").slice(0, 16).replace("T", "_").replace(":", "");

// 업로드할 캡쳐 목록 (원본 경로 → 저장소 경로)
const uploads = [];
const placeCapture = new Map();
placeRun.place.forEach((p, i) => {
  if (!p.capture) return;
  const dest = `${clientId}/place/${placeStamp}/${String(i + 1).padStart(2, "0")}.jpg`;
  uploads.push([join(SRC, p.capture), dest]);
  placeCapture.set(p.keyword, dest);
});
const cafeCapture = new Map();
R.cafe.items.forEach((c, i) => {
  if (!c.capture) return;
  const dest = `${clientId}/cafe/${cafeStamp}/${String(i + 1).padStart(2, "0")}.jpg`;
  uploads.push([join(SRC, c.capture), dest]);
  cafeCapture.set(c.url, dest);
});

const sql = [];
sql.push(`do $seed$ declare cid uuid := '${clientId}'; up uuid; rid uuid; begin`);
for (const t of ["blog_rank_results", "place_rank_results", "blog_posts", "tracked_keywords", "cafe_posts", "cardnews_rounds", "web_columns", "aeo_checks", "client_services", "data_uploads"]) {
  sql.push(`delete from public.${t} where client_id = cid;`);
}
// 계약 항목 (5월 리포트 기준 진행 항목 · 수량)
sql.push(`insert into public.client_services (client_id, service, monthly_target, note) values
  (cid, 'blog', ${R.blog.length}, '5월 리포트 기준'), (cid, 'place', null, '플레이스 키워드 ${R.place.length}개 모니터링'),
  (cid, 'cafe', null, '카페 배포는 2~4월 진행 (5월 없음)'), (cid, 'cardnews', ${R.cardnews.rounds.length}, '인스타그램·당근·카카오'),
  (cid, 'column', ${R.columns.length}, '홈페이지 칼럼'), (cid, 'aeo', null, 'AEO 노출 키워드 ${R.aeo.length}개');`);
sql.push(`insert into public.data_uploads (client_id, kind, item_count, note) values (cid, 'content', ${R.blog.length + R.columns.length + R.cafe.items.length}, '엑셀 리포트·샘플 페이지에서 이전') returning id into up;`);
// 블로그 원고
R.blog.forEach((b, i) => sql.push(`insert into public.blog_posts (client_id, period, keyword, title, url, sort) values (cid, '2026-05', ${q(b.keyword)}, ${q(b.title)}, ${q(b.url)}, ${i});`));
// 추적 키워드
const kw = [["blog_extra", R.extraKeywords], ["place", R.place], ["aeo", R.aeo], ["etc", R.etc]];
for (const [kind, list] of kw) list.forEach((k, i) => sql.push(`insert into public.tracked_keywords (client_id, kind, keyword, sort) values (cid, '${kind}', ${q(k)}, ${i}) on conflict do nothing;`));
// 블로그 순위
for (const b of blogRun.blog) {
  sql.push(`insert into public.blog_rank_results (client_id, keyword, post_url, main_rank, blog_tab_rank, main_other, tab_other, collected_at, upload_id)
    values (cid, ${q(b.keyword)}, ${q(b.url)}, ${n(b.main)}, ${n(b.blogTab)}, ${j(b.mainOther)}, ${j(b.tabOther)}, ${q(blogRun.collectedAt)}, up);`);
}
// 플레이스 순위 + 캡쳐
for (const p of placeRun.place) {
  sql.push(`insert into public.place_rank_results (client_id, keyword, rank, ad_rank, capture_path, collected_at, upload_id)
    values (cid, ${q(p.keyword)}, ${n(p.rank)}, ${n(p.adRank)}, ${q(placeCapture.get(p.keyword))}, ${q(placeRun.collectedAt)}, up);`);
}
// 카페 (4월 배포분)
const cafePeriod = `${R.report.year}-${String(R.cafe.sourceMonth).padStart(2, "0")}`;
R.cafe.items.forEach((c, i) => {
  sql.push(`insert into public.cafe_posts (client_id, period, posted_on, cafe_name, url, title, views, comments, stats_basis, status, note, capture_path, capture_source, captured_at, current_views, current_comments, sort)
    values (cid, '${cafePeriod}', ${q(c.date)}, ${q(c.cafe)}, ${q(c.url)}, ${q(c.title)}, ${n(c.views)}, ${n(c.comments)}, ${q(R.cafe.basis)}, ${q(c.status ?? "게시중")}, ${q(c.note || null)},
            ${q(cafeCapture.get(c.url))}, ${q(c.captureSource ?? null)}, ${q(c.checkedAt ?? null)}, ${n(c.currentViews)}, ${n(c.currentComments)}, ${i});`);
});
// 카드뉴스
R.cardnews.rounds.forEach((r, i) => {
  sql.push(`insert into public.cardnews_rounds (client_id, period, round_no, topic) values (cid, '2026-05', ${i + 1}, null) returning id into rid;`);
  for (const l of r.links) sql.push(`insert into public.cardnews_links (round_id, client_id, media, url) values (rid, cid, ${q(l.media)}, ${q(l.url)});`);
});
// 홈페이지 칼럼
R.columns.forEach((c, i) => sql.push(`insert into public.web_columns (client_id, period, title, url, sort) values (cid, '2026-05', ${q(c.title)}, ${q(c.url)}, ${i});`));
// 계약 채널: 네이버만 계약
sql.push(`update public.client_ad_channels set contracted = (channel = 'naver') where client_id = cid;`);
sql.push(`end $seed$;`);

const dir = mkdtempSync(join(tmpdir(), "seed-"));
const sqlFile = join(dir, "seed.sql");
writeFileSync(sqlFile, sql.join("\n"), "utf8");
console.log("SQL", sb(["db", "query", "--linked", "-f", sqlFile]).includes("error") ? "오류 확인 필요" : "적용");

// CLI 가 드라이브 문자(G:) 경로를 로컬 파일로 인식하지 못해, 앱 폴더 안 임시 폴더로 복사한 뒤 상대 경로로 올린다
const TMP = ".tmp-upload";
mkdirSync(TMP, { recursive: true });
try {
  uploads.forEach(([src, dest], i) => {
    const local = `./${TMP}/${i}.jpg`;
    copyFileSync(src, local);
    sb(["storage", "cp", local, `ss:///captures/${dest}`, "--linked", "--experimental", "--content-type", "image/jpeg"]);
  });
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
console.log("캡쳐 업로드", uploads.length, "장");
