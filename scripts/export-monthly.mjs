// 월 1회 자료 내보내기: 광고주별 지난달 리포트 자료를 엑셀로 G 드라이브에 저장
//   저장 위치: G:\공유 드라이브\15. 회사 자체 PJT\report-portal\monthly-reports\{YYYY-MM}\
//   파일 이름: {내보낸 날 YYMMDD}_{업체명}_{M}월_레포트.xlsx   (예: 261101_서울청명안과_10월_레포트.xlsx)
// 실행: node scripts/export-monthly.mjs            → 지난달
//       node scripts/export-monthly.mjs 2026-10    → 지정한 달
//       node scripts/export-monthly.mjs --auto     → 지난달 파일이 이미 있으면 아무것도 하지 않음 (예약 작업용)
// 예약: Windows 작업 스케줄러 "ReportPortal-MonthlyExport" (매일 10:00 확인 → 매월 처음 한 번 저장, scripts/schedule-tasks.ps1)
import ExcelJS from "exceljs";
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { json, kst, kstDate, sql } from "./lib/db.mjs";

const ROOT = "G:\\공유 드라이브\\15. 회사 자체 PJT\\report-portal\\monthly-reports";
const now = kst();
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(process.argv[2] ?? "") ? process.argv[2] : prev;
const [Y, M] = period.split("-").map(Number);
const from = `${period}-01`;
const to = new Date(Date.UTC(Y, M, 0)).toISOString().slice(0, 10);
const stamp = kstDate().slice(2).replace(/-/g, "");   // YYMMDD
const outDir = join(ROOT, period);
if (process.argv.includes("--auto") && existsSync(outDir) && readdirSync(outDir).some((f) => f.endsWith("_레포트.xlsx"))) process.exit(0);   // 이미 내보냄
mkdirSync(outDir, { recursive: true });
const log = (m) => { const line = `[${kst().toISOString().slice(0, 19).replace("T", " ")}] ${m}`; console.log(line); appendFileSync(join(ROOT, "export-log.txt"), line + "\n", "utf8"); };

const SVC = { blog: "블로그", column: "홈페이지 칼럼", place: "플레이스", cafe: "카페 바이럴", daangn: "당근마켓 바이럴", cardnews: "SNS 카드뉴스", review: "리뷰", aeo: "AEO", etc: "기타" };
const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, "_").trim();

const clients = sql(`select id, name, category, area from public.clients order by name`);
log(`${period} 내보내기 시작 · 광고주 ${clients.length}곳`);

for (const c of clients) {
  const p = json({ client: c.id, period, from, to });
  // 한 번에 모아 오기 (계약 · 진행 · 콘텐츠 · 순위 · 광고)
  const [d] = sql(`
    with a as (select (${p}->>'client')::uuid c, ${p}->>'period' p, (${p}->>'from')::date f, (${p}->>'to')::date t)
    select
      (select row_to_json(m) from public.client_month_contracts m, a where m.client_id = a.c and m.period = a.p) as contract,
      public._contract_items(a.c, a.p) as items,
      (select coalesce(json_agg(b order by b.sort, b.created_at), '[]') from (
         select b.keyword, b.title, b.url, b.published_on, b.sort, b.created_at,
                (select r.main_rank from public.blog_rank_results r where r.client_id = a.c and r.keyword = b.keyword and r.collected_at <= a.t + 1 order by r.collected_at desc limit 1) main_rank,
                (select r.blog_tab_rank from public.blog_rank_results r where r.client_id = a.c and r.keyword = b.keyword and r.collected_at <= a.t + 1 order by r.collected_at desc limit 1) tab_rank
           from public.blog_posts b where b.client_id = a.c and b.period = a.p) b) as blog,
      (select coalesce(json_agg(w order by w.sort), '[]') from public.web_columns w where w.client_id = a.c and w.period = a.p) as columns,
      (select coalesce(json_agg(x order by x.channel, x.posted_on), '[]') from public.cafe_posts x where x.client_id = a.c and x.period = a.p) as cafe,
      (select coalesce(json_agg(json_build_object('round', r.round_no, 'posted_on', r.posted_on, 'topic', r.topic,
                 'links', (select json_agg(json_build_object('media', l.media, 'url', l.url)) from public.cardnews_links l where l.round_id = r.id)) order by r.round_no), '[]')
         from public.cardnews_rounds r where r.client_id = a.c and r.period = a.p) as cardnews,
      (select coalesce(json_agg(pl order by pl.keyword), '[]') from (
         select k.keyword, (select r.rank from public.place_rank_results r where r.client_id = a.c and r.keyword = k.keyword and r.collected_at <= a.t + 1 order by r.collected_at desc limit 1) rank,
                (select r.collected_at from public.place_rank_results r where r.client_id = a.c and r.keyword = k.keyword and r.collected_at <= a.t + 1 order by r.collected_at desc limit 1) at
           from public.tracked_keywords k where k.client_id = a.c and k.kind = 'place' and k.active) pl) as place,
      (select coalesce(json_agg(n order by n.stat_date), '[]') from (
         select stat_date, sum(impressions) impressions, sum(clicks) clicks, sum(cost) cost, sum(conversions) conversions
           from public.naver_daily_stats s where s.client_id = a.c and s.stat_date between a.f and a.t group by stat_date) n) as naver,
      (select coalesce(json_agg(q.file_name), '[]') from public.client_quotes q where q.client_id = a.c and q.period = a.p) as files
    from a`);

  const wb = new ExcelJS.Workbook();
  wb.creator = "믿는구석 리포트 포털";
  const head = (ws, cols) => {
    ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF2F7" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  const items = d.items ?? [];
  const sum = (k) => items.reduce((s, i) => s + Number(i[k] ?? 0), 0);
  const ws0 = wb.addWorksheet("요약");
  ws0.addRows([
    [`${c.name} ${M}월 리포트`], [`기간 ${from} ~ ${to}`, `내보낸 날 ${kstDate()}`], [],
    ["업종 · 지역", [c.category, c.area].filter(Boolean).join(" · ")],
    ["계약 금액", d.contract?.amount ?? "미등록"],
    ["계약 수량 진행", `${items.reduce((s, i) => s + Math.min(i.done, i.quantity), 0)} / ${sum("quantity")}`],
    ["블로그 발행", d.blog.length], ["홈페이지 칼럼", d.columns.length],
    ["카페 바이럴", d.cafe.filter((x) => x.channel === "cafe").length], ["당근마켓 바이럴", d.cafe.filter((x) => x.channel === "daangn").length],
    ["SNS 카드뉴스", `${d.cardnews.length}회차`],
    ["네이버 광고비", Math.round(d.naver.reduce((s, x) => s + Number(x.cost), 0))], ["네이버 광고 클릭", d.naver.reduce((s, x) => s + Number(x.clicks), 0)],
    ["견적서 · 계약서", d.files.join(", ") || "없음"],
  ]);
  ws0.getCell("A1").font = { bold: true, size: 14 };
  ws0.getColumn(1).width = 18; ws0.getColumn(2).width = 40;

  const ws1 = wb.addWorksheet("계약 항목");
  head(ws1, [["구분", "kind", 8], ["업무", "svc", 16], ["세부 내용", "label", 24], ["수량", "quantity", 8], ["진행", "done", 8], ["마감일", "dueOn", 12], ["메모", "note", 30]]);
  for (const i of items) ws1.addRow({ kind: i.extra ? "추가" : i.fallback ? "월 목표" : "견적", svc: SVC[i.service] ?? i.service, label: i.label ?? "", quantity: i.quantity, done: i.done, dueOn: i.dueOn, note: i.note ?? "" });

  const ws2 = wb.addWorksheet("블로그");
  head(ws2, [["키워드", "keyword", 24], ["제목", "title", 40], ["주소", "url", 40], ["발행일", "published_on", 12], ["네이버 메인", "main_rank", 11], ["블로그 탭", "tab_rank", 10]]);
  d.blog.forEach((b) => ws2.addRow({ ...b, main_rank: b.main_rank ?? "순위 밖", tab_rank: b.tab_rank ?? "순위 밖" }));

  const ws3 = wb.addWorksheet("홈페이지 칼럼");
  head(ws3, [["제목", "title", 40], ["주소", "url", 50], ["게시일", "published_on", 12]]);
  d.columns.forEach((x) => ws3.addRow(x));

  for (const [ch, label, where] of [["cafe", "카페", "카페명"], ["daangn", "당근", "지역 · 게시판"]]) {
    const ws = wb.addWorksheet(label);
    head(ws, [["업로드일", "posted_on", 12], [where, "cafe_name", 18], ["제목", "title", 30], ["주소", "url", 45], ["조회", "views", 8], ["댓글", "comments", 8], ["상태", "status", 8]]);
    d.cafe.filter((x) => x.channel === ch).forEach((x) => ws.addRow(x));
  }

  const ws5 = wb.addWorksheet("SNS 카드뉴스");
  head(ws5, [["회차", "round", 6], ["게시일", "posted_on", 12], ["주제", "topic", 30], ["인스타그램", "insta", 40], ["카카오 소식", "kakao", 40], ["당근 소식", "daangn", 40]]);
  d.cardnews.forEach((r) => { const u = (m) => (r.links ?? []).find((l) => l.media === m)?.url ?? ""; ws5.addRow({ ...r, insta: u("인스타그램"), kakao: u("카카오채널"), daangn: u("당근마켓") }); });

  const ws6 = wb.addWorksheet("플레이스 순위");
  head(ws6, [["키워드", "keyword", 24], ["순위(광고 제외)", "rank", 14], ["수집 시각", "at", 20]]);
  d.place.forEach((x) => ws6.addRow({ keyword: x.keyword, rank: x.rank ?? "순위 밖", at: x.at ? kst(new Date(x.at)).toISOString().slice(0, 16).replace("T", " ") : "수집 전" }));

  const ws7 = wb.addWorksheet("네이버 광고 일별");
  head(ws7, [["날짜", "stat_date", 12], ["노출", "impressions", 10], ["클릭", "clicks", 8], ["광고비(원)", "cost", 12], ["전환", "conversions", 8]]);
  d.naver.forEach((x) => ws7.addRow({ ...x, cost: Math.round(Number(x.cost)) }));

  const file = join(outDir, `${stamp}_${safeName(c.name)}_${M}월_레포트.xlsx`);
  await wb.xlsx.writeFile(file);
  log(`저장: ${file}`);
}
log(`${period} 내보내기 끝`);
