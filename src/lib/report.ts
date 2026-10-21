// 리포트 데이터 접근 (서버 전용)
// - 직원 화면:  staff_* 함수 (로그인 + 직원 권한을 DB에서 확인)
// - 광고주 화면: report_* 함수 (링크 토큰을 DB에서 검증, 해당 광고주 데이터만)
// 화면은 DB만 읽는다. 네이버 API를 직접 호출하지 않는다.
import "server-only";
import { supabaseForClientLink, supabaseForStaff } from "./supabase/server";

export type ReportCtx = { mode: "staff"; clientId: string } | { mode: "client"; token: string };

export type ChannelState = { contracted: boolean; apiConnected: boolean };
export type ClientSummary = {
  id: string; slug: string; name: string; category: string | null; area: string | null;
  channels: Partial<Record<"naver" | "daangn" | "kakao", ChannelState>>;
};

export type NaverReport = {
  notContracted?: true;
  from: string; to: string;
  kpi: { cost: number; impressions: number; clicks: number; ctr: number | null; cpc: number | null; conversions: number; roas: number | null };
  daily: { date: string; cost: number; impressions: number; clicks: number; conversions: number }[];
  campaigns: { id: string; name: string; cost: number; impressions: number; clicks: number; ctr: number | null; cpc: number | null; avgRank: number | null; conversions: number; roas: number | null }[];
  lastCollectedAt: string | null;
};

export const basePath = (ctx: ReportCtx) => (ctx.mode === "staff" ? `/admin/clients/${ctx.clientId}` : `/r/${ctx.token}`);

export async function getClientSummary(ctx: ReportCtx): Promise<ClientSummary | null> {
  if (ctx.mode === "staff") {
    const db = await supabaseForStaff();
    const { data, error } = await db.rpc("staff_report_client", { p_client: ctx.clientId });
    return error ? null : (data as ClientSummary | null);
  }
  const { data, error } = await supabaseForClientLink().rpc("report_client", { p_token: ctx.token });
  return error ? null : (data as ClientSummary | null);
}

export async function getNaverReport(ctx: ReportCtx, from: string, to: string): Promise<NaverReport | null> {
  const { data, error } = ctx.mode === "staff"
    ? await (await supabaseForStaff()).rpc("staff_report_naver", { p_client: ctx.clientId, p_from: from, p_to: to })
    : await supabaseForClientLink().rpc("report_naver", { p_token: ctx.token, p_from: from, p_to: to });
  return error ? null : (data as NaverReport | null);
}

// 한국시간 기준 날짜
export function kstToday(offset = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

export type Period = { key: "yesterday" | "7d" | "30d" | "custom"; from: string; to: string; label: string };

export function resolvePeriod(sp: { range?: string; from?: string; to?: string }): Period {
  const y = kstToday(-1);
  const valid = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (sp.range === "custom" && valid(sp.from) && valid(sp.to) && sp.from! <= sp.to!) {
    return { key: "custom", from: sp.from!, to: sp.to! > y ? y : sp.to!, label: `${sp.from} ~ ${sp.to}` };
  }
  if (sp.range === "yesterday") return { key: "yesterday", from: y, to: y, label: "어제" };
  if (sp.range === "30d") return { key: "30d", from: kstToday(-30), to: y, label: "최근 30일" };
  return { key: "7d", from: kstToday(-7), to: y, label: "최근 7일" };
}
