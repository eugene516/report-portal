"use client";
// 문의관리 화면 (브라우저)
// - 위쪽 하위 메뉴: 보드 전체 · 진행중(절차) · 대기 · 보류 · 계약 · 미계약 | 전체 목록 · 통계 · 설정 (주소 ?view= 로 유지)
// - 카드를 누르면 오른쪽 상세 패널, '+ 새 문의'는 원문 붙여넣기 → AI 항목 채우기 창
// - 저장은 로그인 세션으로 직접 하고, DB 규칙(RLS · 트리거)이 직원 · 담당 · 관리자 여부를 다시 확인한다
// - 다른 직원이 바꾼 내용은 실시간으로 반영된다(Supabase Realtime)
import "./inquiry.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ask, toast, toastError } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { IqCtx, type IqApi, type NewFields } from "./ctx";
import { BOARD_STAGES, EVENT_COLS, INQUIRY_COLS, isActive, isStale, stageName, STAGES,
  type EventKind, type Inquiry, type IqEvent, type MonthlySummary, type Settings, type Stage, type StaffUser } from "./model";
import { BoardView, ListView, ParkedView, WonView } from "./Views";
import { StatsView } from "./StatsView";
import { SettingsView } from "./SettingsView";
import DetailPanel from "./DetailPanel";
import NewInquiry from "./NewInquiry";

const VIEWS = ["all", "board", "waiting", "hold", "won", "lost", "list", "stats", "settings"] as const;
type View = (typeof VIEWS)[number];

// DB 오류 → 화면 문구 (권한 거절은 트리거 · RLS 가 보낸다)
const errText = (e: { code?: string; message?: string } | null, fallback: string) =>
  e?.code === "42501" ? (e.message && /[가-힣]/.test(e.message) ? e.message : "권한이 없습니다.") : fallback;

export default function InquiryApp(p: {
  today: string; meId: string; isAdmin: boolean; initialView: string;
  cards: Inquiry[]; events: IqEvent[]; settings: Settings; staff: StaffUser[]; summaries: MonthlySummary[];
}) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const { today, meId, isAdmin, staff } = p;
  const [cards, setCards] = useState(p.cards);
  const [events, setEvents] = useState(p.events);
  const [settings, setSettings] = useState(p.settings);
  const [summaries, setSummaries] = useState(p.summaries);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [live, setLive] = useState(false);

  // 하위 메뉴: 주소의 ?view= 를 따른다 (history.pushState 로 바꾸면 서버를 다시 부르지 않는다)
  const sp = useSearchParams();
  const raw = sp.get("view") ?? p.initialView;
  const view: View = (VIEWS as readonly string[]).includes(raw) ? (raw as View) : "board";
  const go = (v: View) => {
    const q = new URLSearchParams(sp.toString());
    q.set("view", v);
    window.history.pushState(null, "", `?${q.toString()}`);
  };

  // 실시간 반영
  useEffect(() => {
    const ch = sb.channel("inquiry-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "inquiries" }, (m) => {
        if (m.eventType === "DELETE") { const id = (m.old as { id?: string }).id; setCards((l) => l.filter((x) => x.id !== id)); return; }
        const row = m.new as Inquiry;
        setCards((l) => (l.some((x) => x.id === row.id) ? l.map((x) => (x.id === row.id ? { ...x, ...row } : x)) : [row, ...l]));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "inquiry_events" }, (m) => {
        if (m.eventType === "DELETE") { const id = (m.old as { id?: string }).id; setEvents((l) => l.filter((x) => x.id !== id)); return; }
        const row = m.new as IqEvent;
        setEvents((l) => (l.some((x) => x.id === row.id) ? l : [...l, row]));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "inquiry_settings" }, (m) => {
        const row = m.new as Settings;
        setSettings({ channels: row.channels, services: row.services, lost_reasons: row.lost_reasons, sla: row.sla });
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => { sb.removeChannel(ch); };
  }, [sb]);

  const nameOf = useCallback((id: string | null) => (id ? staff.find((s) => s.id === id)?.name ?? "?" : "미정"), [staff]);
  const canManage = useCallback((c: Inquiry) => isAdmin || !c.owner || c.owner === meId, [isAdmin, meId]);
  const canDelete = useCallback((c: Inquiry) => isAdmin || c.owner === meId, [isAdmin, meId]);

  const upsertCard = (row: Inquiry) => setCards((l) => (l.some((x) => x.id === row.id) ? l.map((x) => (x.id === row.id ? row : x)) : [row, ...l]));
  const mergeEvents = (rows: IqEvent[]) => setEvents((l) => [...l, ...rows.filter((r) => !l.some((x) => x.id === r.id))]);
  const reloadEvents = async (id: string) => {
    const { data } = await sb.from("inquiry_events").select(EVENT_COLS).eq("inquiry_id", id).order("created_at");
    if (data) mergeEvents(data as IqEvent[]);
  };

  // 기본 정보 · 다음 액션 등: 화면 먼저 반영 → 실패하면 되돌린다
  async function patch(c: Inquiry, changes: Partial<Inquiry>) {
    const before = cards.find((x) => x.id === c.id) ?? c;
    setCards((l) => l.map((x) => (x.id === c.id ? { ...x, ...changes } : x)));
    const { data, error } = await sb.from("inquiries").update(changes).eq("id", c.id).select(INQUIRY_COLS).single();
    if (error || !data) { upsertCard(before); toastError(errText(error, "저장하지 못했습니다.")); return false; }
    upsertCard(data as Inquiry);
    return true;
  }
  // 단계 이동: DB가 기본값(계약일 · 확인일 등)을 채우므로 저장 결과를 받아 화면에 반영
  async function setStage(c: Inquiry, s: Stage) {
    if (c.stage === s) return true;
    if (!canManage(c)) { toastError("담당자 또는 관리자만 단계를 바꿀 수 있습니다."); return false; }
    const { data, error } = await sb.from("inquiries").update({ stage: s }).eq("id", c.id).select(INQUIRY_COLS).single();
    if (error || !data) { toastError(errText(error, "단계를 바꾸지 못했습니다.")); return false; }
    upsertCard(data as Inquiry);
    reloadEvents(c.id);
    toast(isActive(s) ? `${c.company} → ${stageName(s)} 단계로 옮겼습니다.` : `${c.company} → ${stageName(s)}(으)로 옮겼습니다. 위 '${stageName(s)}' 메뉴에서 관리합니다.`);
    return true;
  }
  async function addEvent(c: Inquiry, kind: EventKind, body: string) {
    const text = body.trim().slice(0, 8000);
    if (!text) return false;
    const { data, error } = await sb.from("inquiry_events").insert({ inquiry_id: c.id, kind, body: text, author: meId }).select(EVENT_COLS).single();
    if (error || !data) { toastError(errText(error, "기록하지 못했습니다.")); return false; }
    mergeEvents([data as IqEvent]);
    if (kind !== "ai") setCards((l) => l.map((x) => (x.id === c.id && x.last_activity_on < today ? { ...x, last_activity_on: today } : x)));
    return true;
  }
  async function removeEvent(e: IqEvent) {
    if (!await ask("이 기록을 삭제할까요?")) return;
    const { error } = await sb.from("inquiry_events").delete().eq("id", e.id);
    if (error) return toastError(errText(error, "삭제하지 못했습니다."));
    setEvents((l) => l.filter((x) => x.id !== e.id));
  }
  async function removeCard(c: Inquiry) {
    if (!await ask(`${c.company} 문의를 삭제할까요?\n상담 이력도 함께 삭제되며 되돌릴 수 없습니다.`)) return false;
    const { error } = await sb.from("inquiries").delete().eq("id", c.id);
    if (error) { toastError(errText(error, "삭제하지 못했습니다.")); return false; }
    setCards((l) => l.filter((x) => x.id !== c.id));
    setEvents((l) => l.filter((x) => x.inquiry_id !== c.id));
    toast("삭제했습니다.");
    return true;
  }
  async function createCard(f: NewFields) {
    const { data, error } = await sb.from("inquiries").insert(f).select(INQUIRY_COLS).single();
    if (error || !data) { toastError(errText(error, "등록하지 못했습니다.")); return null; }
    upsertCard(data as Inquiry);
    reloadEvents(data.id);
    return data as Inquiry;
  }
  async function saveSettings(changes: Partial<Settings>) {
    const before = settings;
    setSettings({ ...settings, ...changes });
    const { error } = await sb.from("inquiry_settings").update({ ...changes, updated_at: new Date().toISOString(), updated_by: meId }).eq("id", 1);
    if (error) { setSettings(before); toastError(errText(error, "설정을 저장하지 못했습니다.")); return false; }
    return true;
  }

  const api: IqApi = {
    today, meId, isAdmin, settings, staff, cards, events, nameOf, canManage, canDelete,
    openCard: setOpenId, openNew: () => setNewOpen(true),
    patch, setStage, addEvent, removeEvent, removeCard, createCard, saveSettings,
  };

  // Esc: 새 문의 창 → 상세 패널 순서로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".modal[role=alertdialog]")) return;
      if (newOpen) setNewOpen(false); else if (openId) setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newOpen, openId]);

  const count = (s: Stage) => cards.filter((c) => c.stage === s).length;
  const activeCount = cards.filter((c) => isActive(c.stage)).length;
  const staleCount = cards.filter((c) => isStale(c, settings.sla, today)).length;
  const open = openId ? cards.find((c) => c.id === openId) ?? null : null;

  const NAV: { v: View; label: string; n?: number; sep?: boolean }[] = [
    { v: "all", label: "보드 전체", n: cards.length },
    { v: "board", label: "진행중 (절차)", n: activeCount },
    { v: "waiting", label: "대기", n: count("waiting") },
    { v: "hold", label: "보류", n: count("hold") },
    { v: "won", label: "계약", n: count("won") },
    { v: "lost", label: "미계약", n: count("lost") },
    { v: "list", label: "전체 목록", sep: true },
    { v: "stats", label: "통계" },
    { v: "settings", label: "설정" },
  ];

  return (
    <IqCtx.Provider value={api}>
      <div className="iq">
        <div className="iq-head">
          <div>
            <div className="faint">믿는구석 · 영업 문의</div>
            <h1>문의관리</h1>
            <div className="faint iq-mt-xs">
              진행 중 {activeCount}건
              {staleCount > 0 ? <span className="iq-t-warn"> · 놓치고 있는 문의 {staleCount}건</span> : " · 모두 제때 대응 중"}
              <span className={`live-dot ${live ? "on" : ""}`} title={live ? "다른 직원의 변경이 바로 반영됩니다" : "연결 중"}>{live ? "실시간" : "연결 중"}</span>
            </div>
          </div>
          <button className="btn primary" onClick={() => setNewOpen(true)}>+ 새 문의</button>
        </div>

        <nav className="iq-subnav" aria-label="문의관리 메뉴">
          {NAV.map((n) => (
            <span key={n.v} className="iq-subnav-i">
              {n.sep && <span className="iq-subnav-sep" aria-hidden="true" />}
              <button className={view === n.v ? "on" : ""} aria-current={view === n.v ? "page" : undefined} onClick={() => go(n.v)}>
                {n.label}{n.n != null && <span className="iq-n">{n.n}</span>}
              </button>
            </span>
          ))}
        </nav>

        {view === "all" && <BoardView stages={STAGES} title="보드 전체" desc="모든 단계를 한 화면에서 봅니다. 카드를 끌어 어느 열로든 옮길 수 있습니다." />}
        {view === "board" && <BoardView stages={BOARD_STAGES} title="진행중 (절차)" desc="카드를 끌어서 단계를 옮깁니다. 계약 · 대기 · 보류 · 미계약으로 보낼 때는 카드 상세의 단계 버튼을 씁니다." />}
        {view === "waiting" && <ParkedView kind="waiting" />}
        {view === "hold" && <ParkedView kind="hold" />}
        {view === "lost" && <ParkedView kind="lost" />}
        {view === "won" && <WonView />}
        {view === "list" && <ListView />}
        {view === "stats" && <StatsView summaries={summaries} onSummary={(s) => setSummaries((l) => [s, ...l])} />}
        {view === "settings" && <SettingsView />}
      </div>

      {open && <DetailPanel key={open.id} c={open} onClose={() => setOpenId(null)} />}
      {newOpen && <NewInquiry onClose={() => setNewOpen(false)} onCreated={(c) => { setNewOpen(false); if (view !== "all" && view !== "board") go("board"); setOpenId(c.id); toast("문의 단계에 등록했습니다."); }} />}
    </IqCtx.Provider>
  );
}
