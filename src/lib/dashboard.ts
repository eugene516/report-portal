// 대시보드 데이터 (서버 전용). DB 함수가 호출자 권한에 맞는 광고주만 돌려준다.
import "server-only";
import { supabaseForStaff } from "./supabase/server";

export type ClientRow = {
  id: string; name: string; category: string | null; area: string | null;
  staff: { id: string; name: string; primary: boolean }[];
  services: Record<string, number | null>;
  channels: Record<string, { contracted: boolean; apiConnected: boolean }>;
  blog_count: number; blog_top5: number; place_total: number; place_top3: number; place_avg: number | null;
  place_last_at: string | null; blog_last_at: string | null;
  cafe_count: number; cafe_deleted: number; cafe_views: number; card_rounds: number; column_count: number;
  last_sync: { status: string; at: string; error: string | null } | null; sync_failed_7d: number;
};
export type StaffRow = { id: string; email: string; name: string; role: "owner" | "admin" | "staff"; createdAt: string; mustChange: boolean; invitedAt: string | null; mailedAt: string | null; lastSignIn: string | null; clients: { id: string; name: string; primary: boolean }[] };

export async function getOverview(period: string): Promise<ClientRow[]> {
  const db = await supabaseForStaff();
  const { data } = await db.rpc("dashboard_overview", { p_period: period });
  return (data as ClientRow[] | null) ?? [];
}

export async function getStaffOverview(): Promise<StaffRow[]> {
  const db = await supabaseForStaff();
  const { data } = await db.rpc("staff_overview");
  return (data as StaffRow[] | null) ?? [];
}

export type Alert = { level: "high" | "mid" | "info"; client: ClientRow; text: string; href: string };

// 확인 필요 항목 (DB 데이터 기준)
export function buildAlerts(rows: ClientRow[], period: string): Alert[] {
  const out: Alert[] = [];
  const now = Date.now();
  const kstDay = new Date(now + 9 * 3600_000);
  const isCurrent = kstDay.toISOString().slice(0, 7) === period;
  const progress = isCurrent ? kstDay.getUTCDate() / new Date(kstDay.getUTCFullYear(), kstDay.getUTCMonth() + 1, 0).getDate() : 1;
  for (const c of rows) {
    const base = `/admin/clients/${c.id}`;
    if (c.sync_failed_7d > 0) out.push({ level: "high", client: c, text: `네이버 광고 수집 실패 ${c.sync_failed_7d}건 (최근 7일)`, href: `${base}/settings` });
    if (c.cafe_deleted > 0) out.push({ level: "high", client: c, text: `카페 게시글 삭제 ${c.cafe_deleted}건 → AS 확인`, href: `${base}/cafe` });
    if (!c.staff.some((s) => s.primary)) out.push({ level: "mid", client: c, text: "주담당 직원이 지정되지 않았습니다", href: `${base}/settings` });
    if (c.channels.naver?.contracted && !c.channels.naver.apiConnected) out.push({ level: "mid", client: c, text: "네이버 광고 계약 · API 키 미등록", href: `${base}/settings` });
    const target = c.services.blog;
    if (target && c.blog_count < Math.floor(target * progress) - 1) out.push({ level: "mid", client: c, text: `블로그 발행 지연 (${c.blog_count}/${target}건)`, href: `${base}/blog?period=${period}` });
    for (const [k, label] of [["blog_last_at", "블로그"], ["place_last_at", "플레이스"]] as const) {
      const svc = k === "blog_last_at" ? "blog" : "place";
      if (svc in c.services && (!c[k] || now - new Date(c[k]!).getTime() > 7 * 86_400_000)) {
        out.push({ level: "info", client: c, text: `${label} 순위 ${c[k] ? "7일 넘게 미수집" : "수집 이력 없음"}`, href: `${base}/upload` });
      }
    }
  }
  const order = { high: 0, mid: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
