// 파일 검수 데이터 (서버 전용) — 월간 리포트 · 성과 집계와 분리된 별도 기능
// - 리포트 링크(토큰): 개수 요약만 (사이드바 대기 건수 · 대시보드 검수 현황). 콘텐츠 · 파일은 볼 수 없다
// - 광고주 계정 로그인: 자기 병원의 검수 요청된 콘텐츠 · 파일 (RLS)
// - 직원: 담당 광고주의 전체 (RLS)
import "server-only";
import type { ReportCtx } from "./report";
import { supabaseForClientLink, supabaseForStaff } from "./supabase/server";

export const REVIEW_KINDS: Record<string, string> = { blog: "블로그", column: "홈페이지 칼럼", cardnews: "SNS 카드뉴스", etc: "기타" };
export const REVIEW_STATUS: Record<string, { label: string; badge: string }> = {
  draft: { label: "작성 중", badge: "" },
  pending: { label: "검수 대기", badge: "warn" },
  approved: { label: "검수 완료", badge: "good" },
  changes: { label: "재검수 요청", badge: "bad" },
};

export type ReviewSummary = { pending: number; kinds: { kind: string; requested: number; approved: number; target: number }[] };
export type ReviewItem = {
  id: string; client_id: string; kind: string; period: string; title: string; status: string; version: number;
  requested_at: string | null; approved_version: number | null; approved_at: string | null; created_at: string;
};
export type ReviewFile = { id: string; item_id: string; version: number; file_name: string; storage_path: string; mime_type: string | null; size_bytes: number | null; sort: number; url?: string | null };
export type ReviewEvent = { id: number; item_id: string; version: number; action: string; comment: string | null; actor_name: string | null; actor_kind: string; created_at: string; file_id: string | null };

export async function getReviewSummary(ctx: ReportCtx, period: string): Promise<ReviewSummary | null> {
  const { data } = ctx.mode === "staff"
    ? await (await supabaseForStaff()).rpc("staff_review_summary", { p_client: ctx.clientId, p_period: period })
    : await supabaseForClientLink().rpc("report_review_summary", { p_token: ctx.token, p_period: period });
  return (data as ReviewSummary | null) ?? null;
}

// 지금 로그인한 사람이 이 광고주의 광고주 계정인지 (리포트 링크 화면에서 검수하려면 필요)
export type ReviewViewer = { kind: "none" } | { kind: "other" } | { kind: "client"; userId: string; name: string; email: string };
export async function getReviewViewer(clientId: string): Promise<ReviewViewer> {
  const db = await supabaseForStaff();
  const { data: claims } = await db.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return { kind: "none" };
  const { data } = await db.from("client_users").select("user_id, client_id, name, email").eq("user_id", uid).maybeSingle();
  if (!data || data.client_id !== clientId) return { kind: "other" };
  return { kind: "client", userId: uid, name: data.name ?? data.email, email: data.email };
}

// 로그인 세션(직원 · 광고주 계정)으로 목록 · 상세 읽기 — 볼 수 있는 범위는 RLS 가 정한다
export async function getReviewList(clientId: string, period: string | null) {
  const db = await supabaseForStaff();
  let q = db.from("review_items").select("id, client_id, kind, period, title, status, version, requested_at, approved_version, approved_at, created_at").eq("client_id", clientId);
  if (period) q = q.eq("period", period);
  const [{ data: items }, { data: periods }] = await Promise.all([
    q.order("created_at", { ascending: false }),
    db.from("review_items").select("period").eq("client_id", clientId),
  ]);
  return { items: (items ?? []) as ReviewItem[], periods: [...new Set((periods ?? []).map((p) => p.period as string))].sort().reverse() };
}

export async function getReviewDetail(itemId: string) {
  const db = await supabaseForStaff();
  const { data: item } = await db.from("review_items").select("id, client_id, kind, period, title, status, version, requested_at, approved_version, approved_at, created_at").eq("id", itemId).maybeSingle();
  if (!item) return null;
  const [{ data: files }, { data: events }] = await Promise.all([
    db.from("review_files").select("id, item_id, version, file_name, storage_path, mime_type, size_bytes, sort").eq("item_id", itemId).order("version", { ascending: false }).order("sort").order("created_at"),
    db.from("review_events").select("id, item_id, version, action, comment, actor_name, actor_kind, created_at, file_id").eq("item_id", itemId).order("created_at", { ascending: false }),
  ]);
  const list = (files ?? []) as ReviewFile[];
  const { data: signed } = list.length ? await db.storage.from("reviews").createSignedUrls(list.map((f) => f.storage_path), 1800) : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return { item: item as ReviewItem, files: list.map((f) => ({ ...f, url: url.get(f.storage_path) ?? null })), events: (events ?? []) as ReviewEvent[] };
}

// 목록에서 바로 원문 보기 · 검수: 항목마다 지금 버전 파일(서명 주소)과 코멘트 기록을 함께 읽는다
export type ReviewRow = ReviewItem & { files: ReviewFile[]; events: ReviewEvent[] };
export async function withFilesAndEvents(items: ReviewItem[]): Promise<ReviewRow[]> {
  if (items.length === 0) return [];
  const db = await supabaseForStaff();
  const ids = items.map((i) => i.id);
  const [{ data: files }, { data: events }] = await Promise.all([
    db.from("review_files").select("id, item_id, version, file_name, storage_path, mime_type, size_bytes, sort").in("item_id", ids).order("sort").order("created_at"),
    db.from("review_events").select("id, item_id, version, action, comment, actor_name, actor_kind, created_at, file_id").in("item_id", ids).order("created_at", { ascending: false }),
  ]);
  const ver = new Map(items.map((i) => [i.id, i.version]));
  const cur = ((files ?? []) as ReviewFile[]).filter((x) => x.version === ver.get(x.item_id));
  const { data: signed } = cur.length ? await db.storage.from("reviews").createSignedUrls(cur.map((x) => x.storage_path), 1800) : { data: [] };
  const url = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]));
  return items.map((i) => ({
    ...i,
    files: cur.filter((x) => x.item_id === i.id).map((x) => ({ ...x, url: url.get(x.storage_path) ?? null })),
    events: ((events ?? []) as ReviewEvent[]).filter((e) => e.item_id === i.id),
  }));
}
