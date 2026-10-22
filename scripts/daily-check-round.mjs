// 매일 9시 점검 — ego-browser 안에서 실행되는 부분 (scripts/daily-check.mjs 가 입력 파일을 만들어 실행한다)
// 입력: globalThis.__RP_CHECK = { input, output } (JSON 파일 경로)
// 1) 블로그 원고: 네이버 메인(통합검색) · 블로그 탭 순위, 같은 블로그의 다른 글 순위
// 2) 플레이스 키워드: 플레이스 영역 순위(광고 제외) · 광고 자리
// 3) 카페 · 당근 게시글: 삭제 여부 · 현재 조회수 · 댓글 수
// 4) 리포트 포털 화면 점검: 주요 화면이 오류 없이 열리는지
const fs = await import("node:fs/promises");
const { input, output } = globalThis.__RP_CHECK;
const job = JSON.parse(await fs.readFile(input, "utf8"));
const task = await taskSpace("리포트 포털 매일 점검");
const page = task.page("p1");
const pause = (a, b) => page.waitForTimeout(a + Math.random() * (b - a));
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

// 2) 플레이스 순위 (광고 제외)
for (const p of job.place) {
  try {
    await page.goto("https://search.naver.com/search.naver?where=nexearch&query=" + encodeURIComponent(p.keyword));
    await page.waitForLoadState(); await page.waitForTimeout(1500);
    const r = await page.evaluate((NAME) => {
      const box = [...document.querySelectorAll(".api_subject_bx")].find((b) => /^플레이스/.test((b.innerText || "").trim()) && b.querySelector("a[href*='place']"));
      if (!box) return { noBlock: true };
      const lis = [...box.querySelectorAll("li")].filter((li) => li.querySelector("a[href*='place']") && !li.parentElement.closest("li"));
      let organic = 0, ads = 0, rank = null, adRank = null;
      for (const li of lis) {
        const text = (li.innerText || "").replace(/\s+/g, " ");
        if (/(^| )광고( |$)/.test(text)) { ads++; if (adRank == null && text.includes(NAME)) adRank = ads; continue; }
        organic++;
        if (rank == null && text.includes(NAME)) rank = organic;
      }
      return { rank, adRank };
    }, p.placeName);
    result.place.push({ client: p.client, keyword: p.keyword, rank: r.rank ?? null, adRank: r.adRank ?? null, noBlock: !!r.noBlock, at: new Date().toISOString() });
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

// 4) 리포트 포털 화면 점검 (로그인된 브라우저)
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
