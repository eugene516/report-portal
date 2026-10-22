// 매일 9시 점검 — ego-browser 안에서 실행되는 부분 (scripts/daily-check.mjs 가 입력 파일을 만들어 실행한다)
// 입력: globalThis.__RP_CHECK = { input, output } (JSON 파일 경로)
// 1) 블로그 원고: 네이버 메인(통합검색) · 블로그 탭 순위, 같은 블로그의 다른 글 순위
// 2) 플레이스 키워드: 플레이스 영역 순위(광고 제외) · 광고 자리
// 3) 카페 · 당근 게시글: 삭제 여부 · 현재 조회수 · 댓글 수
// 4) 홈페이지 칼럼 · 인스타그램 · 카카오 채널 · 당근 소식: 이번 달 게시물 링크와 제목 (캡쳐 없음)
// 5) 리포트 포털 화면 점검: 주요 화면이 오류 없이 열리는지
const fs = await import("node:fs/promises");
const { input, output } = globalThis.__RP_CHECK;
const job = JSON.parse(await fs.readFile(input, "utf8"));
const task = await taskSpace("리포트 포털 매일 점검");
const page = task.page("p1");
const pause = (a, b) => page.waitForTimeout(a + Math.random() * (b - a));
// 캡쳐 두 장을 합치는 빈 페이지 (네이버 페이지 보안 정책과 무관하게 그리기 위해 따로 둔다)
const tool = job.captureDir ? await task.newPage() : null;
if (tool) await tool.goto("about:blank");
async function stitch(files, out) {
  const data = await Promise.all(files.map(async (f) => "data:image/png;base64," + (await fs.readFile(f)).toString("base64")));
  const jpg = await tool.evaluate(async (srcs) => {
    const imgs = await Promise.all(srcs.map((s) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = s; })));
    const gap = 12, w = Math.max(...imgs.map((i) => i.naturalWidth)), h = imgs.reduce((a, i) => a + i.naturalHeight, 0) + gap * (imgs.length - 1);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
    let y = 0; for (const i of imgs) { x.drawImage(i, 0, y); y += i.naturalHeight + gap; }
    return c.toDataURL("image/jpeg", 0.85);
  }, data);
  await fs.writeFile(out, Buffer.from(jpg.split(",")[1], "base64"));
  for (const f of files) await fs.rm(f, { force: true });
}
const result = { startedAt: new Date().toISOString(), blog: [], place: [], cafe: [], portal: [], errors: [] };
const save = () => fs.writeFile(output, JSON.stringify(result, null, 1), "utf8");

async function scrollAll(max) {
  for (let i = 0; i < max; i++) {
    const end = await page.evaluate(() => { window.scrollBy(0, 1400); return window.scrollY + window.innerHeight >= document.body.scrollHeight - 80; });
    await page.waitForTimeout(400);
    if (end && i > 2) { await page.waitForTimeout(800); if (await page.evaluate(() => window.scrollY + window.innerHeight >= document.body.scrollHeight - 80)) break; }
  }
}
const collect = () => page.evaluate(() => {
  const out = [], seen = new Set();
  document.querySelectorAll("a[href]").forEach((a) => {
    if (a.closest("[class*='ad_'], .lst_type, #power_link_body")) return;
    let m = a.href.match(/^https?:\/\/(?:m\.)?(blog|cafe)\.naver\.com\/([^/?#]+)\/(\d+)/);
    let item = m && { t: m[1], id: m[2], post: m[3] };
    if (!item) { m = a.href.match(/^https?:\/\/in\.naver\.com\/([^/?#]+)\/contents\/internal\/(\d+)/); item = m && { t: "influencer", id: m[1], post: m[2] }; }
    if (!item) return;
    const key = item.t + "/" + item.id + "/" + item.post;
    if (seen.has(key)) return;
    seen.add(key); out.push(item);
  });
  return out;
});
const find = (list, account, post) => {
  const i = list.findIndex((x) => x.post === post);
  const o = list.findIndex((x) => x.id === account && x.post !== post);
  return { rank: i >= 0 ? i + 1 : null, other: o >= 0 ? { rank: o + 1, url: `https://blog.naver.com/${account}/${list[o].post}` } : null };
};

// 1) 블로그 순위
for (const b of job.blog) {
  try {
    const q = encodeURIComponent(b.keyword);
    await page.goto("https://search.naver.com/search.naver?where=nexearch&query=" + q);
    await page.waitForLoadState(); await page.waitForTimeout(1200);
    await scrollAll(12);
    const main = find(await collect(), b.account, b.post);
    await pause(1500, 3000);
    await page.goto("https://search.naver.com/search.naver?ssc=tab.blog.all&query=" + q);
    await page.waitForLoadState(); await page.waitForTimeout(1200);
    let tabList = await collect();
    for (let i = 0; i < 6 && tabList.length < 100 && !tabList.some((x) => x.post === b.post); i++) { await scrollAll(6); tabList = await collect(); }
    const tab = find(tabList.filter((x) => x.t !== "cafe"), b.account, b.post);
    result.blog.push({ client: b.client, keyword: b.keyword, url: b.url, main: main.rank, blogTab: tab.rank, mainOther: main.rank ? null : main.other, tabOther: tab.rank ? null : tab.other, at: new Date().toISOString() });
  } catch (e) { result.errors.push(`블로그 ${b.keyword}: ${String(e).slice(0, 120)}`); }
  await save(); await pause(2000, 4000);
}

// 2) 플레이스 순위(광고 제외) · 플레이스 광고(광고 딱지가 붙은 해당 업체 항목)
//    순위: 첫 페이지에 없으면 아래쪽 '다음 페이지'로 최대 5페이지까지 넘겨 찾는다(순위는 페이지를 이어 센다)
//    캡쳐(위아래로 합친 JPG): 검색창(키워드 빨간 박스) + 플레이스 영역 전체(대상 항목 빨간 박스, 아래 페이지 표시까지)
//      - 순위 캡쳐: 순위로 센 일반 항목에만 박스
//    플레이스 광고: 첫 페이지 광고 자리에서 해당 업체가 몇 번째인지 (캡쳐 없음)
const RED = "4px solid #ff0000";
const placeBox = () => [...document.querySelectorAll(".api_subject_bx")].find((b) => /^플레이스/.test((b.innerText || "").trim()) && b.querySelector("a[href*='place']"));
async function capturePlace(p, kind) {
  const rect = await page.evaluate(async ({ RED, src, kind }) => {
    const input = document.querySelector("#nx_query");
    if (input) { input.style.outline = RED; input.style.outlineOffset = "5px"; input.style.borderRadius = "2px"; }
    const box = new Function("return " + src)()();
    for (const li of box.querySelectorAll("[data-rp-org], [data-rp-ad]")) { li.style.outline = ""; }
    const target = box.querySelector(kind === "ad" ? "[data-rp-ad]" : "[data-rp-org]");
    if (target) { target.style.outline = RED; target.style.outlineOffset = "-4px"; target.style.position = "relative"; target.style.zIndex = "5"; }
    box.scrollIntoView({ block: "start" });
    await new Promise((ok) => setTimeout(ok, 1200));
    const rc = (el) => { const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; };
    const bx = rc(box);
    let bottom = bx.y + bx.h;
    const sib = box.nextElementSibling;
    if (sib && /\d+\s*\/\s*\d+/.test(sib.innerText || "") && rc(sib).h < 80) bottom = rc(sib).y + rc(sib).h;
    return { input: input && rc(input), block: { ...bx, h: bottom - bx.y + 6 } };
  }, { RED, src: placeBox.toString(), kind });
  if (!rect.input) return null;
  const base = `${job.captureDir}/${p.client}_${String(p.idx).padStart(2, "0")}${kind === "ad" ? "_ad" : ""}`;
  await page.screenshot({ path: base + "_head.png", fullPage: true, clip: { x: rect.block.x, y: Math.max(0, rect.input.y - 22), width: rect.block.w, height: rect.input.h + 44 } });
  await page.screenshot({ path: base + "_block.png", fullPage: true, clip: { x: rect.block.x, y: rect.block.y, width: rect.block.w, height: rect.block.h } });
  await stitch([base + "_head.png", base + "_block.png"], base + ".jpg");
  return base + ".jpg";
}
for (const p of job.place) {
  try {
    await page.goto("https://search.naver.com/search.naver?where=nexearch&query=" + encodeURIComponent(p.keyword));
    await page.waitForLoadState(); await page.waitForTimeout(1500);
    let organicBefore = 0, rank = null, adRank = null, pageNo = 1, noBlock = false, adCapture = null;
    for (; pageNo <= 5; pageNo++) {
      const r = await page.evaluate(({ NAME, organicBefore, src }) => {
        const box = new Function("return " + src)()();
        if (!box) return { noBlock: true };
        const lis = [...box.querySelectorAll("li")].filter((li) => li.querySelector("a[href*='place']") && !li.parentElement.closest("li"));
        let organic = organicBefore, ads = 0, rank = null, adRank = null;
        for (const li of lis) {
          const text = (li.innerText || "").replace(/\s+/g, " ");
          if (/(^| )광고( |$)/.test(text)) { ads++; if (adRank == null && text.includes(NAME)) { adRank = ads; li.dataset.rpAd = "1"; } continue; }
          organic++;
          if (rank == null && text.includes(NAME)) { rank = organic; li.dataset.rpOrg = "1"; }
        }
        const next = box.querySelector(".cmm_pg_next") ?? [...box.querySelectorAll("a, button")].filter((el) => (el.textContent || "").trim() === "다음").pop();
        const disabled = !next || next.getAttribute("aria-disabled") === "true" || next.hasAttribute("disabled");
        return { organic, rank, adRank, hasNext: !disabled };
      }, { NAME: p.placeName, organicBefore, src: placeBox.toString() });
      if (r.noBlock) { noBlock = true; break; }
      // 플레이스 광고: 첫 페이지 광고 자리 순위만 기록 (캡쳐 안 함)
      if (pageNo === 1 && r.adRank != null) adRank = r.adRank;
      if (r.rank != null) { rank = r.rank; break; }
      organicBefore = r.organic;
      if (!r.hasNext) break;
      await page.evaluate((src) => {
        const box = new Function("return " + src)()();
        (box.querySelector(".cmm_pg_next") ?? [...box.querySelectorAll("a, button")].filter((el) => (el.textContent || "").trim() === "다음").pop())?.click();
      }, placeBox.toString());
      await page.waitForTimeout(1500);
    }
    if (rank == null) pageNo = null;
    let capture = null;
    if (tool && !noBlock) { try { capture = await capturePlace(p, "org"); } catch (e) { result.errors.push(`캡쳐 ${p.keyword}: ${String(e).slice(0, 100)}`); } }
    result.place.push({ client: p.client, keyword: p.keyword, idx: p.idx, rank, adRank, page: pageNo, noBlock, capture, adCapture, at: new Date().toISOString() });
  } catch (e) { result.errors.push(`플레이스 ${p.keyword}: ${String(e).slice(0, 120)}`); }
  await save(); await pause(2000, 4000);
}

// 3) 카페 · 당근 게시글 상태
for (const c of job.cafe) {
  try {
    await page.goto(c.url);
    await page.waitForLoadState(); await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const docs = [document];
      const f = document.querySelector("iframe#cafe_main");
      try { if (f?.contentDocument) docs.push(f.contentDocument); } catch { /* 다른 출처 */ }
      const text = docs.map((d) => d.body?.innerText ?? "").join("\n");
      const deleted = /삭제되었거나|존재하지 않는 게시글|삭제된 게시글|게시글이 없습니다|게시물이 삭제|찾을 수 없는 페이지|글이 존재하지 않/.test(text);
      const num = (re) => { const m = text.match(re); return m ? Number(m[1].replace(/,/g, "")) : null; };
      return { deleted, views: num(/조회\s*([\d,]+)/), comments: num(/댓글\s*([\d,]+)/) };
    });
    result.cafe.push({ id: c.id, ...r, at: new Date().toISOString() });
  } catch (e) { result.errors.push(`게시글 ${c.url.slice(0, 60)}: ${String(e).slice(0, 120)}`); }
  await save(); await pause(1500, 3000);
}

// 4) 채널 게시물 (이번 달만)
const inMonth = (d) => d && d.slice(0, 7) === job.period;
const kstDay = (iso) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const relDay = (t) => {
  const s = (t ?? "").replace(/\s+/g, "");
  let m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/(\d+)일전/); if (m) return kstDay(Date.now() - Number(m[1]) * 86_400_000);
  if (/(\d+)(시간|분|초)전|방금/.test(s)) return kstDay(Date.now());
  return null;
};
result.columns = []; result.sns = [];
for (const src of job.sources ?? []) {
  try {
    await page.goto(src.url);
    await page.waitForLoadState(); await page.waitForTimeout(3500);
    if (src.kind === "column") {
      const cards = await page.evaluate(() => [...new Map([...document.querySelectorAll("a[href*='bmode=view'][href*='idx=']")].map((a) => {
        const card = a.closest("[class*=card], li, article, .item") ?? a;
        const lines = (card.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean);
        return [a.href.match(/idx=(\d+)/)?.[1], { url: a.href, title: lines[0] ?? "", text: lines.join(" ") }];
      })).values()]);
      for (const c of cards) { const d = relDay(c.text.match(/(\d{4}-\d{2}-\d{2}|\d+\s*일\s*전|\d+\s*시간\s*전|방금)/)?.[1]); if (inMonth(d) && c.title) result.columns.push({ client: src.client, url: c.url, title: c.title, date: d }); }
    } else if (src.kind === "daangn") {
      for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 1500)); await page.waitForTimeout(700); }
      const posts = await page.evaluate(() => [...new Map([...document.querySelectorAll("a[href*='/business-post/']")].map((a) => {
        const card = a.closest("li, article, [class*=item], [class*=post]") ?? a;
        const t = card.querySelector("time")?.getAttribute("datetime");
        const title = (card.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean)[0] ?? "";
        return [a.href.split("?")[0], { url: a.href.split("?")[0], title, at: t }];
      })).values()]);
      for (const p of posts) { const d = p.at ? kstDay(p.at) : null; if (inMonth(d)) result.sns.push({ client: src.client, media: "당근마켓", url: p.url, title: p.title, date: d }); }
    } else if (src.kind === "kakao") {
      for (let i = 0; i < 2; i++) { await page.evaluate(() => window.scrollBy(0, 1500)); await page.waitForTimeout(700); }
      const posts = await page.evaluate(() => {
        const out = new Map();
        for (const d of document.querySelectorAll(".item_date, [class*=date]")) {
          let card = d.parentElement;
          while (card && !card.querySelector("a[href*='/contents/posts/'], a[href*='/posts/']")) card = card.parentElement;
          const a = card?.querySelector("a[href*='/contents/posts/'], a[href*='/posts/']");
          const id = a?.getAttribute("href")?.match(/(\d{6,})/)?.[1];
          if (!id || out.has(id)) continue;
          const title = (card.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean)[0] ?? "";
          out.set(id, { id, title, dateText: d.textContent.trim() });
        }
        return [...out.values()];
      });
      const ch = src.url.match(/pf\.kakao\.com\/(_[A-Za-z0-9]+)/)?.[1];
      for (const p of posts) { const d = relDay(p.dateText); if (inMonth(d) && ch) result.sns.push({ client: src.client, media: "카카오채널", url: `https://pf.kakao.com/${ch}/${p.id}`, title: p.title, date: d }); }
    } else if (src.kind === "instagram") {
      const links = await page.evaluate(() => [...new Set([...document.querySelectorAll("a[href*='/p/'], a[href*='/reel/']")].map((a) => a.href.split("?")[0]))].slice(0, 12));
      let older = 0;
      for (const url of links) {
        await page.goto(url); await page.waitForLoadState(); await page.waitForTimeout(2200);
        const info = await page.evaluate(() => ({ at: document.querySelector("time[datetime]")?.getAttribute("datetime"), og: document.querySelector('meta[property="og:title"]')?.content ?? "" }));
        const d = info.at ? kstDay(info.at) : null;
        const title = (info.og.match(/[“"]([^\n"”]+)/)?.[1] ?? "").trim();
        if (inMonth(d)) { result.sns.push({ client: src.client, media: "인스타그램", url: url.replace(/\/[^/]+\/(p|reel)\//, "/$1/"), title, date: d }); older = 0; }
        else if (d && d < job.period + "-01" && ++older >= 3) break;   // 고정 게시물 때문에 순서가 섞일 수 있어 3개 연속 지난달이면 멈춤
        await pause(1200, 2200);
      }
    }
  } catch (e) { result.errors.push(`${src.kind} ${src.url.slice(0, 50)}: ${String(e).slice(0, 120)}`); }
  await save(); await pause(1500, 3000);
}

// 5) 리포트 포털 화면 점검 (로그인된 브라우저)
for (const [name, path] of job.portal) {
  try {
    await page.goto(job.site + path);
    await page.waitForLoadState();
    for (let k = 0; k < 20 && (await page.evaluate(() => document.body.innerText.includes("불러오는 중"))); k++) await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ url: location.pathname, bad: /Application error|This page could not be found|문제가 발생했습니다/.test(document.body.innerText.slice(0, 3000)) }));
    result.portal.push({ name, ok: !r.bad && !r.url.startsWith("/login"), note: r.url.startsWith("/login") ? "로그인이 풀려 있음" : r.bad ? "오류 화면" : "" });
  } catch (e) { result.portal.push({ name, ok: false, note: String(e).slice(0, 120) }); }
}
result.finishedAt = new Date().toISOString();
await save();
await task.finish({ keep: [] });
console.log(`점검 끝: 블로그 ${result.blog.length} · 플레이스 ${result.place.length} · 게시글 ${result.cafe.length} · 오류 ${result.errors.length}`);
