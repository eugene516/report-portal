// 리포트 내용(블로그·플레이스·카페·카드뉴스·칼럼·AEO) 조회와 캡쳐 주소 (서버 전용)
import "server-only";
import type { ReportCtx } from "./report";
import { supabaseForClientLink, supabaseForStaff } from "./supabase/server";

export type RankOther = { rank: number; url: string } | null;
export type ReportContent = {
  period: string;
  periods: string[];
  services: Record<string, { target: number | null }>;
  blog: { id: string; keyword: string; title: string; url: string; type: string; publishedOn: string | null;
          rank: { main: number | null; blogTab: number | null; mainOther: RankOther; tabOther: RankOther; at: string } | null }[];
  keywords: { kind: "blog_extra" | "place" | "aeo" | "etc"; keyword: string; important?: boolean;
              blogRank: { main: number | null; blogTab: number | null; at: string } | null;
              place: { rank: number | null; adRank: number | null; capture: string | null; at: string } | null }[];
  cafe: { id: string; channel: "cafe" | "daangn"; postedOn: string | null; cafe: string; url: string; title: string | null; views: number | null; comments: number | null;
          basis: string | null; status: string; note: string | null; capture: string | null; captureSource: "live" | "report" | null;
          capturedAt: string | null; currentViews: number | null; currentComments: number | null }[];
  cardnews: { round: number; postedOn: string | null; topic: string | null; links: { media: string; url: string }[] }[];
  columns: { title: string; url: string; publishedOn: string | null }[];
  aeo: { keyword: string; source: string | null; mentioned: boolean | null }[];
};

// 한국시간 기준 이번 달
export const currentPeriod = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);

export async function getContent(ctx: ReportCtx, period: string): Promise<ReportContent | null> {
  const { data, error } = ctx.mode === "staff"
    ? await (await supabaseForStaff()).rpc("staff_report_content", { p_client: ctx.clientId, p_period: period })
    : await supabaseForClientLink().rpc("report_content", { p_token: ctx.token, p_period: period });
  return error ? null : (data as ReportContent | null);
}

// 보고 월: 요청한 월이 있으면 그 달(지난 레포트 보기), 없으면 이번 달 (리포트는 당월 내용만 기본으로 보여준다)
export async function getContentForRequest(ctx: ReportCtx, requested?: string): Promise<ReportContent | null> {
  const want = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) && requested <= currentPeriod() ? requested : currentPeriod();
  return getContent(ctx, want);
}

export type HistoryMonth = { period: string; blog: number; cafe: number; daangn: number; cardnews: number; column: number; adCost: number | null };
export async function getHistory(ctx: ReportCtx): Promise<HistoryMonth[]> {
  const { data } = ctx.mode === "staff"
    ? await (await supabaseForStaff()).rpc("staff_report_history", { p_client: ctx.clientId })
    : await supabaseForClientLink().rpc("report_history", { p_token: ctx.token });
  return (data as HistoryMonth[] | null) ?? [];
}

// 캡쳐 주소
// - 직원: 로그인 세션으로 비공개 저장소의 2분짜리 서명 주소 생성 (저장소 정책이 담당 여부를 다시 확인)
// - 광고주 링크: report-capture 함수 주소 (함수가 토큰과 광고주를 확인한 뒤 서명 주소로 이동)
export async function captureUrls(ctx: ReportCtx, paths: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (list.length === 0) return out;
  if (ctx.mode === "client") {
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/report-capture`;
    for (const p of list) out.set(p, `${base}?t=${encodeURIComponent(ctx.token)}&p=${encodeURIComponent(p)}`);
    return out;
  }
  const db = await supabaseForStaff();
  const { data } = await db.storage.from("captures").createSignedUrls(list, 600);
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}

export const SERVICE_LABELS: Record<string, string> = {
  blog: "블로그", place: "플레이스", cafe: "카페 바이럴", daangn: "당근마켓 바이럴", review: "리뷰",
  cardnews: "SNS 카드뉴스", column: "홈페이지 칼럼", aeo: "AEO",
};
