// 네이버 검색광고 API 클라이언트 (서버 전용)
// 공식 문서: https://naver.github.io/searchad-apidoc/  (2026-10-21 확인)
// - Base URL: https://api.searchad.naver.com
// - 서명: Base64(HMAC-SHA256(비밀키, "{timestamp}.{METHOD}.{URI}")), URI는 쿼리스트링을 뺀 경로
// - 헤더: X-Timestamp(밀리초), X-API-KEY(액세스라이선스), X-Customer(CUSTOMER_ID), X-Signature
// - 429(호출 한도 초과)와 5xx·네트워크 오류는 지수 백오프로 최대 3회 재시도
import type { NaverCredentials } from "./crypto.ts";

const BASE_URL = "https://api.searchad.naver.com";
const MAX_RETRIES = 3;

export class NaverApiError extends Error {
  constructor(public status: number, public code: string | null, public title: string | null) {
    // 응답 본문 전체나 요청 헤더는 메시지에 넣지 않는다
    super(`Naver API ${status}${code ? ` (${code})` : ""}${title ? `: ${title}` : ""}`);
    this.name = "NaverApiError";
  }
}

async function sign(secretKey: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...sig));
}

type Query = Record<string, string | string[] | undefined>;

function buildQuery(query: Query = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    // 공식 샘플(python requests)처럼 배열은 같은 키를 반복한다: ids=a&ids=b
    for (const item of Array.isArray(v) ? v : [v]) p.append(k, item);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function naverGet<T>(creds: NaverCredentials, uri: string, query?: Query): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const timestamp = Date.now().toString();
    const signature = await sign(creds.secretKey, `${timestamp}.GET.${uri}`);
    let res: Response | null = null;
    try {
      res = await fetch(BASE_URL + uri + buildQuery(query), {
        method: "GET",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Timestamp": timestamp,
          "X-API-KEY": creds.accessLicense,
          "X-Customer": creds.customerId,
          "X-Signature": signature,
        },
      });
    } catch (_e) {
      // 네트워크 오류: 재시도 대상 (원본 오류 객체에는 요청 정보가 담길 수 있어 버린다)
      if (attempt < MAX_RETRIES) { await sleep(backoff(attempt)); continue; }
      throw new NaverApiError(0, "NETWORK", "network error");
    }
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      await res.body?.cancel();
      await sleep(backoff(attempt, res.headers.get("Retry-After")));
      continue;
    }
    let code: string | null = null, title: string | null = null;
    try { const j = await res.json(); code = j?.code != null ? String(j.code) : null; title = j?.title ? String(j.title).slice(0, 120) : null; } catch { /* 본문 없음 */ }
    throw new NaverApiError(res.status, code, title);
  }
}

function backoff(attempt: number, retryAfter?: string | null): number {
  const ra = retryAfter ? Number(retryAfter) * 1000 : 0;
  const base = 1000 * 2 ** attempt;                 // 1s, 2s, 4s
  return Math.max(ra, base) + Math.floor(Math.random() * 400);
}

// ── API 래퍼 ────────────────────────────────────────────────────────────────

export type NaverCampaign = { nccCampaignId: string; name: string; campaignTp?: string; status?: string };
export type NaverAdgroup = { nccAdgroupId: string; nccCampaignId: string; name: string; adgroupType?: string; status?: string };

// 성과 필드 (공식 문서의 fields 유효값 중 사용하는 것)
export const STAT_FIELDS = ["impCnt", "clkCnt", "salesAmt", "ctr", "cpc", "avgRnk", "ccnt", "convAmt", "ror"] as const;
export type NaverStat = { id: string } & Partial<Record<(typeof STAT_FIELDS)[number], number>>;

export const listCampaigns = (c: NaverCredentials) => naverGet<NaverCampaign[]>(c, "/ncc/campaigns");
export const listAdgroups = (c: NaverCredentials, nccCampaignId: string) =>
  naverGet<NaverAdgroup[]>(c, "/ncc/adgroups", { nccCampaignId });

// 키워드 목록 (광고그룹별, recordSize 최대 1000 — 공식 문서)
export type NaverKeyword = { nccKeywordId: string; nccAdgroupId: string; keyword: string; status?: string; bidAmt?: number; useGroupBidAmt?: boolean };
export const listKeywords = (c: NaverCredentials, nccAdgroupId: string) =>
  naverGet<NaverKeyword[]>(c, "/ncc/keywords", { nccAdgroupId, recordSize: "1000" });

// 비즈머니 잔액 (GET /billing/bizmoney → { bizmoney, budgetLock, refundLock, customerId })
export const getBizmoney = (c: NaverCredentials) =>
  naverGet<{ bizmoney?: number; budgetLock?: boolean }>(c, "/billing/bizmoney");

// 하루 단위 요약 성과 (timeRange since=until 로 하루씩 요청)
// timeIncrement 일별 응답은 문서의 허용값 설명이 엇갈려 쓰지 않는다.
// 한 번에 넣을 수 있는 ids 개수가 문서에 명시되어 있지 않아 50개씩 나눠 요청한다 (같은 수준의 엔티티끼리만)
const STATS_CHUNK = 50;
export async function getDailyStats(c: NaverCredentials, ids: string[], date: string): Promise<NaverStat[]> {
  const out: NaverStat[] = [];
  for (let i = 0; i < ids.length; i += STATS_CHUNK) {
    const res = await naverGet<{ data?: NaverStat[] }>(c, "/stats", {
      ids: ids.slice(i, i + STATS_CHUNK),
      fields: JSON.stringify(STAT_FIELDS),
      timeRange: JSON.stringify({ since: date, until: date }),
    });
    out.push(...(res.data ?? []));
  }
  return out;
}
