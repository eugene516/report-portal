// 당월 계약 진행 현황 (서버 전용). DB 함수가 호출자 권한에 맞는 광고주만 돌려준다.
import "server-only";
import { supabaseForStaff } from "./supabase/server";
import { SERVICE_LABELS } from "./content";

export type ContractItem = { id: string | null; service: string; label: string | null; quantity: number; done: number; auto: boolean; dueOn: string; extra?: boolean; note?: string | null; fallback?: boolean };
export type MonthClient = {
  id: string; name: string; category: string | null; area: string | null;
  staff: { id: string; name: string; primary: boolean }[];
  contract: { amount: number | null; startsOn: string | null; endsOn: string | null; memo: string | null; updatedAt: string } | null;
  items: ContractItem[];
  channels: Record<string, { contracted: boolean; apiConnected: boolean; budget: number | null; spent: number | null }>;
  files: number; cafe_deleted: number; sync_failed_7d: number;
};
export type MonthDetail = {
  adDaily: { date: string; cost: number }[];
  history: { period: string; quantity: number; done: number }[];
  files: { id: string; path: string; name: string; kind: "quote" | "contract"; at: string }[];
};

export async function getMonthOverview(period: string, clientId?: string): Promise<MonthClient[]> {
  const db = await supabaseForStaff();
  const { data } = await db.rpc("month_overview", clientId ? { p_period: period, p_client: clientId } : { p_period: period });
  return (data as MonthClient[] | null) ?? [];
}

export async function getMonthDetail(clientId: string, period: string): Promise<MonthDetail | null> {
  const db = await supabaseForStaff();
  const { data, error } = await db.rpc("month_client_detail", { p_client: clientId, p_period: period });
  return error ? null : (data as MonthDetail);
}

export const itemLabel = (i: { service: string; label: string | null }) =>
  i.label ? (i.service === "etc" ? i.label : `${SERVICE_LABELS[i.service] ?? i.service} · ${i.label}`) : (SERVICE_LABELS[i.service] ?? i.service);

// 한국시간 기준 오늘
export const kstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export function monthInfo(period: string) {
  const [y, m] = period.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = kstDate();
  const cur = today.slice(0, 7);
  const elapsed = period < cur ? days : period > cur ? 0 : Number(today.slice(8, 10));
  return { y, m, days, today, elapsed, isCurrent: period === cur, last: `${period}-${String(days).padStart(2, "0")}`, label: `${y}년 ${m}월` };
}

// 마감까지 남은 날 (오늘 마감 = 0, 지남 = 음수)
export const daysLeft = (due: string, today = kstDate()) => Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);

export type ItemState = "done" | "late" | "risk" | "ok";
// 완료 / 마감 지남 / 지연 위험(남은 기간 대비 진행이 느림) / 순조
export function itemState(i: ContractItem, period: string, today = kstDate()): ItemState {
  if (i.quantity === 0 || i.done >= i.quantity) return "done";
  const left = daysLeft(i.dueOn, today);
  if (left < 0) return "late";
  const start = Date.parse(`${period}-01`);
  const span = Math.max(1, (Date.parse(i.dueOn) - start) / 86_400_000 + 1);
  const passed = Math.min(span, Math.max(0, (Date.parse(today) - start) / 86_400_000 + 1));
  const expected = (i.quantity * passed) / span;
  return left <= 3 || i.done < expected - Math.max(1, i.quantity * 0.15) ? "risk" : "ok";
}
export const STATE_LABEL: Record<ItemState, string> = { done: "완료", late: "마감 지남", risk: "지연 위험", ok: "순조" };
export const STATE_BADGE: Record<ItemState, string> = { done: "good", late: "bad", risk: "warn", ok: "acc" };

export function totals(items: ContractItem[]) {
  const quantity = items.reduce((s, i) => s + i.quantity, 0);
  const done = items.reduce((s, i) => s + Math.min(i.done, i.quantity), 0);
  return { quantity, done, rate: quantity ? done / quantity : 0 };
}

export const won = (n: number | null | undefined) => (n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`);
export const dday = (left: number) => (left === 0 ? "D-day" : left > 0 ? `D-${left}` : `D+${-left}`);
