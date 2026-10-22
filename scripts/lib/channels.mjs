// 매일 점검 보조: 블로그 RSS(브라우저 없이) · 블로그 키워드 추출 · 카드뉴스 회차 묶기
import { kstDate } from "./db.mjs";

// 네이버 블로그 RSS → 이번 달 글 [{ title, url, postId, publishedOn, tags }]
export async function blogPostsThisMonth(blogUrl, period) {
  const id = blogUrl.match(/blog\.naver\.com\/([^/?#]+)/)?.[1];
  if (!id) return [];
  const res = await fetch(`https://rss.blog.naver.com/${id}.xml`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  const xml = await res.text();
  const cdata = (s) => (s ?? "").replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (n) => cdata(m[1].match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1]);
    const guid = tag("guid");
    const postId = guid.match(/\/(\d+)$/)?.[1];
    const date = new Date(tag("pubDate"));
    if (!postId || Number.isNaN(date.getTime())) continue;
    const publishedOn = kstDate(date);
    if (publishedOn.slice(0, 7) !== period) continue;
    out.push({ title: tag("title"), url: `https://blog.naver.com/${id}/${postId}`, account: id, postId, publishedOn, tags: tag("tag").split(",").map((t) => t.trim()).filter(Boolean) });
  }
  return out;
}

// 제목 앞부분에서 검색 키워드를 뽑는다 (원고 제목은 "지역 + 안과/진료 + 주제 + 설명" 순서로 쓴다)
//   "청량리안과 망막정맥폐쇄 갑자기 …"      → "청량리안과 망막정맥폐쇄"
//   "제기동 노안백내장수술안과 접근성이 …"   → "제기동 노안백내장수술안과"
//   "동대문구 안과 각막검사 눈에 …"          → "동대문구 안과 각막검사"
//   "답십리안과시야흐림원인 책 읽을 때 …"    → "답십리안과시야흐림원인"
//   "청량리 네비게이션백내장 수술 더 …"      → "청량리 네비게이션백내장 수술"
const PARTICLE = /(으로|에서|보다|부터|까지|처럼|이나|이란|이라|은|는|이|가|을|를|에|의|도|로|와|과|만)$/;
const isTopic = (w) => w.length >= 2 && !/[?!.,]/.test(w) && !PARTICLE.test(w) && !/^\d/.test(w);
export function keywordFromTitle(title) {
  const words = title.replace(/[“”"'‘’]/g, "").split(/\s+/).filter(Boolean);
  const hit = words.slice(0, 3).findIndex((w) => /안과|의원|병원|클리닉/.test(w));
  if (hit >= 0) {
    const kw = words.slice(0, hit + 1);
    if (words[hit + 1] && isTopic(words[hit + 1])) kw.push(words[hit + 1]);
    return kw.join(" ");
  }
  const kw = [];
  for (const w of words.slice(0, 3)) { if (kw.length && !isTopic(w)) break; kw.push(w.replace(PARTICLE, "")); }
  return kw.join(" ") || words[0];
}

// 카드뉴스 회차 키: 같은 소식이 인스타그램 · 카카오 · 당근에 올라가면 제목이 같다 → 공백·기호를 뺀 앞 14글자
export const roundKey = (title) => (title ?? "").replace(/[\s\p{P}\p{S}]/gu, "").slice(0, 14);

// "3일 전" · "5시간 전" · "2026.10.14." · "2026-10-19" · "1일전" → YYYY-MM-DD (한국시간)
export function parseKoDate(text, now = new Date()) {
  const t = (text ?? "").replace(/\s+/g, "");
  let m = t.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/(\d+)일전/); if (m) return kstDate(new Date(now.getTime() - Number(m[1]) * 86_400_000));
  if (/(\d+)(시간|분|초)전|방금/.test(t)) return kstDate(now);
  m = t.match(/(\d{1,2})[.월]\s*(\d{1,2})/); if (m) return `${kstDate(now).slice(0, 4)}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}
