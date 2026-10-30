// 할일 자료 형식 · 날짜 도우미 (서버 · 화면 공통)
export type Member = { id: string; name: string; user_id: string | null; job_title: string | null; sort: number };
export type Column = { id: string; name: string; color: string; is_later: boolean; sort: number };
export type Card = {
  id: string; column_id: string; title: string; priority: number; due_on: string | null; today_on: string | null;
  assignee_id: string | null; note: string | null; done: boolean; done_at: string | null; sort: number;
  client_id: string | null; auto: boolean; created_at: string; created_by: string | null;
};
export type Item = {
  id: string; card_id: string; title: string; due_on: string | null; today_on: string | null;
  assignee_id: string | null; note: string | null; done: boolean; done_at: string | null; sort: number;
  created_at: string; created_by: string | null;
};
export type Routine = { id: string; owner_id: string; title: string; sort: number; created_at: string };
export type RoutineLog = { routine_id: string; on_date: string; status: "done" | "skip" };
export type History = { id: number; at: string; title: string; actor_name: string | null; from_name: string | null; to_name: string | null };

export const CARD_COLS = "id, column_id, title, priority, due_on, today_on, assignee_id, note, done, done_at, sort, client_id, auto, created_at, created_by";
export const ITEM_COLS = "id, card_id, title, due_on, today_on, assignee_id, note, done, done_at, sort, created_at, created_by";

export const PRI = ["없음", "낮음", "보통", "높음"] as const;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

// 날짜는 모두 한국 날짜 문자열(YYYY-MM-DD)로 다룬다
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
export const longDate = (d: string) => `${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${WEEK[weekday(d)]})`;
export const kstOf = (ts: string) => new Date(Date.parse(ts) + 9 * 3600_000).toISOString().slice(0, 10);
export const kstStamp = (ts: string) => { const k = new Date(Date.parse(ts) + 9 * 3600_000).toISOString(); return `${md(k.slice(0, 10))} ${k.slice(11, 16)}`; };
// 이번 주 금요일(토·일이면 다음 금요일) · 다음 주 월요일
export const thisFriday = (d: string) => addDays(d, (5 - weekday(d) + 7) % 7);
export const nextMonday = (d: string) => addDays(d, ((1 - weekday(d) + 7) % 7) || 7);

// 루틴 연속 일수: 오늘 완료면 1부터, 어제부터 거꾸로 완료(+1) · 안 함(유지) · 주말 빈칸(유지) · 그 외 빈칸(끊김)
export function streak(r: Routine, logs: Map<string, RoutineLog["status"]>, today: string, maxDays = 120) {
  const start = kstOf(r.created_at);
  let n = logs.get(today) === "done" ? 1 : 0;
  let d = addDays(today, -1);
  for (let i = 0; i < maxDays && d >= start; i++, d = addDays(d, -1)) {
    const s = logs.get(d);
    if (s === "done") n++;
    else if (s === "skip" || weekday(d) === 0 || weekday(d) === 6) continue;
    else break;
  }
  return n;
}
