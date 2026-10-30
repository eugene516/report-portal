// 문의관리 공통: 자료 형태 · 단계 · 상태 판정 · 날짜 도우미 (서버 · 브라우저 공용)

export type Stage = "inquiry" | "responding" | "meeting" | "proposal" | "waiting" | "hold" | "won" | "lost";
export type EventKind = "memo" | "call" | "mail" | "kakao" | "meeting" | "ai" | "stage";

export type Inquiry = {
  id: string; no: number; company: string; person: string | null; phone: string | null; email: string | null;
  channel: string | null; referrer: string | null; services: string[]; budget: string | null; industry: string | null;
  region: string | null; summary: string | null; raw: string | null; stage: Stage; owner: string | null;
  received_on: string; stage_changed_on: string; last_activity_on: string;
  next_action_text: string | null; next_action_on: string | null;
  contract_on: string | null; contract_type: "매월" | "단기" | null; contract_service: string | null;
  lost_reason: string | null; lost_memo: string | null;
  wait_until: string | null; wait_memo: string | null; hold_until: string | null; hold_memo: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
export const INQUIRY_COLS = "id, no, company, person, phone, email, channel, referrer, services, budget, industry, region, summary, raw, stage, owner, received_on, stage_changed_on, last_activity_on, next_action_text, next_action_on, contract_on, contract_type, contract_service, lost_reason, lost_memo, wait_until, wait_memo, hold_until, hold_memo, created_by, created_at, updated_at";

export type IqEvent = { id: string; inquiry_id: string; kind: EventKind; body: string; author: string | null; created_at: string };
export const EVENT_COLS = "id, inquiry_id, kind, body, author, created_at";

export type Settings = { channels: string[]; services: string[]; lost_reasons: string[]; sla: Record<string, number> };
export type StaffUser = { id: string; name: string; email: string; role: "owner" | "admin" | "staff"; job_title: string | null };
export type MonthlySummary = { id: string; period: string; body: string; created_at: string };

// 단계: 앞의 네 개가 진행중(절차) 보드, 나머지는 각자 메뉴에서 관리
export const STAGES: { id: Stage; name: string; sla: boolean; cls: string }[] = [
  { id: "inquiry", name: "문의", sla: true, cls: "" },
  { id: "responding", name: "요청 대응중", sla: true, cls: "" },
  { id: "meeting", name: "미팅", sla: true, cls: "" },
  { id: "proposal", name: "제안·견적", sla: true, cls: "" },
  { id: "waiting", name: "대기", sla: false, cls: "wait" },
  { id: "hold", name: "보류", sla: false, cls: "hold" },
  { id: "won", name: "계약", sla: false, cls: "won" },
  { id: "lost", name: "미계약", sla: false, cls: "lost" },
];
export const BOARD_STAGES = STAGES.filter((s) => s.sla);
export const PARKED: Stage[] = ["waiting", "hold", "won", "lost"];
export const stageName = (s: Stage) => STAGES.find((x) => x.id === s)?.name ?? s;
export const isActive = (s: Stage) => BOARD_STAGES.some((x) => x.id === s);

export const KIND_ICON: Record<EventKind, string> = { call: "📞", mail: "✉️", kakao: "💬", meeting: "🤝", memo: "📝", ai: "AI", stage: "↦" };
export const KIND_NAME: Record<EventKind, string> = { call: "전화", mail: "메일", kakao: "카톡", meeting: "미팅", memo: "메모", ai: "AI", stage: "단계" };
export const NOTE_KINDS: EventKind[] = ["memo", "call", "mail", "kakao", "meeting"];

// 날짜 (모두 'YYYY-MM-DD' 한국시간 날짜)
export const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const md = (d: string | null | undefined) => (d ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : "");
export const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
export const code = (n: number) => `L${String(n).padStart(3, "0")}`;

export type Status = { cls: "" | "warn" | "danger" | "ok" | "hold"; label: string };

// 색 띠: 주황 = 기준일 넘게 기록 없음, 빨강 = 다음 액션 날짜 지남
export function statusOf(c: Inquiry, sla: Record<string, number>, today: string): Status {
  if (c.stage === "won") return { cls: "ok", label: "계약" };
  if (c.stage === "lost") return { cls: "", label: "미계약" };
  if (c.stage === "hold") {
    const u = c.hold_until;
    if (u && diffDays(today, u) >= 0) return { cls: "warn", label: `재접촉일 ${diffDays(today, u) ? `${diffDays(today, u)}일 지남` : "오늘"}` };
    return { cls: "hold", label: "보류" };
  }
  if (c.stage === "waiting") {
    const u = c.wait_until;
    if (u && diffDays(today, u) >= 0) return { cls: "warn", label: `확인일 ${diffDays(today, u) ? `${diffDays(today, u)}일 지남` : "오늘"}` };
    return { cls: "", label: "대기" };
  }
  if (c.next_action_on && diffDays(today, c.next_action_on) > 0) return { cls: "danger", label: `액션 ${diffDays(today, c.next_action_on)}일 지남` };
  const limit = sla[c.stage];
  if (typeof limit === "number" && diffDays(today, c.last_activity_on) > limit) return { cls: "warn", label: `기록 없음 ${diffDays(today, c.last_activity_on)}일` };
  if (c.next_action_on && c.next_action_on === today) return { cls: "", label: "오늘 액션" };
  return { cls: "", label: "" };
}
export const isStale = (c: Inquiry, sla: Record<string, number>, today: string) => ["warn", "danger"].includes(statusOf(c, sla, today).cls);

export const stageChip = (s: Stage) => (s === "won" ? "ok" : s === "lost" ? "danger" : s === "hold" ? "hold" : "acc");
export const roleName = (r: StaffUser["role"]) => (r === "owner" ? "오너" : r === "admin" ? "관리자" : "팀원");
