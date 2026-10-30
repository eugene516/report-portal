"use client";
// 할일 앱: ☀ 오늘 / ▦ 보드 두 화면
// - 지금 보는 사람 = 로그인한 직원. 위쪽 필터: 내 할 일 · 전체 · 다른 멤버
// - 보드: 카테고리 열 · 카드(우선순위 · 마감일 · ☀ 오늘 · 담당 · 세부 항목 · 메모) · 열/카드 추가 · 완료 접기
// - 오늘: 어제 못 한 일(☀ 오늘로 · → 내일로 · ⏳ 나중에) · 오늘 할 일 · 루틴(🔥 연속 · 오늘은 안 함) · 오늘 완료
// - 제목을 누르면 상세 창: 제목 · 담당 · 카테고리 · 우선순위 · 마감일 · ☀ 오늘 · 메모 · 담당자 변경 기록 · 삭제
// - 다른 직원이 바꾼 내용은 실시간으로 반영된다(Supabase Realtime)
// 저장은 로그인 세션으로 직접 하며, DB 규칙이 직원 여부 · 관리자 여부 · 루틴 주인을 다시 확인한다.
import "./todo.css";
import { useEffect, useMemo, useState } from "react";
import { ask, toast, toastError } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { jobRank } from "@/lib/titles";
import { TodoCtx, type Filter, type Kind, type Todo } from "./ctx";
import { CARD_COLS, ITEM_COLS, longDate, type Card, type Column, type Item, type Member, type Routine, type RoutineLog } from "./types";
import { BoardView, TodayView } from "./views";
import Detail from "./Detail";

// 멤버 얼굴 색 (멤버 순서대로)
const MEMBER_COLORS = ["#1f3a5f", "#0f766e", "#9a3412", "#6d28d9", "#be185d", "#0369a1", "#4d7c0f", "#a16207"];
const ROUTINE_COLS = "id, owner_id, title, sort, created_at";

type Row = { id: string };
const upsert = <T extends Row>(l: T[], row: T) => (l.some((x) => x.id === row.id) ? l.map((x) => (x.id === row.id ? { ...x, ...row } : x)) : [...l, row]);
const sameLog = (a: Pick<RoutineLog, "routine_id" | "on_date">, b: Pick<RoutineLog, "routine_id" | "on_date">) => a.routine_id === b.routine_id && a.on_date === b.on_date;

export default function TodoApp(props: {
  today: string; meId: string; myMemberId: string | null; isAdmin: boolean; initialView: "today" | "board";
  members: Member[]; columns: Column[]; cards: Card[]; items: Item[]; routines: Routine[]; logs: RoutineLog[];
  clients: { id: string; name: string }[];
}) {
  const { today, meId, myMemberId, isAdmin, clients } = props;
  const [sb] = useState(() => supabaseBrowser());
  const [members, setMembers] = useState(props.members);
  const [columns, setColumns] = useState(props.columns);
  const [cards, setCards] = useState(props.cards);
  const [items, setItems] = useState(props.items);
  const [routines, setRoutines] = useState(props.routines);
  const [logs, setLogs] = useState(props.logs);
  // 서버 자료가 바뀌면(다시 열기) 화면 목록도 새 자료로 바꾼다
  const [src, setSrc] = useState(props);
  if (src !== props && (src.cards !== props.cards || src.columns !== props.columns || src.routines !== props.routines || src.members !== props.members)) {
    setSrc(props);
    setMembers(props.members); setColumns(props.columns); setCards(props.cards); setItems(props.items); setRoutines(props.routines); setLogs(props.logs);
  }
  const [view, setView] = useState(props.initialView);
  const [filter, setFilter] = useState<Filter>("mine");
  const [detail, setDetail] = useState<{ kind: Kind; id: string } | null>(null);
  const [live, setLive] = useState(false);
  const fail = (t: string) => toastError(t);

  // 실시간 반영: 다른 직원이 추가 · 수정 · 삭제한 열 · 카드 · 세부 항목 · 루틴 · 멤버
  useEffect(() => {
    const gone = (p: { old: unknown }) => (p.old as { id?: string }).id;
    const ch = sb.channel("todo-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "todo_cards" }, (p) => {
        if (p.eventType === "DELETE") { const id = gone(p); setCards((l) => l.filter((x) => x.id !== id)); setItems((l) => l.filter((x) => x.card_id !== id)); return; }
        setCards((l) => upsert(l, p.new as Card));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "todo_items" }, (p) => {
        if (p.eventType === "DELETE") { const id = gone(p); setItems((l) => l.filter((x) => x.id !== id)); return; }
        setItems((l) => upsert(l, p.new as Item));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "todo_columns" }, (p) => {
        if (p.eventType === "DELETE") { const id = gone(p); setColumns((l) => l.filter((x) => x.id !== id)); return; }
        setColumns((l) => upsert(l, p.new as Column));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "todo_routines" }, (p) => {
        if (p.eventType === "DELETE") { const id = gone(p); setRoutines((l) => l.filter((x) => x.id !== id)); return; }
        setRoutines((l) => upsert(l, p.new as Routine));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "todo_routine_logs" }, (p) => {
        if (p.eventType === "DELETE") { const o = p.old as RoutineLog; setLogs((l) => l.filter((x) => !sameLog(x, o))); return; }
        const row = p.new as RoutineLog;
        setLogs((l) => [...l.filter((x) => !sameLog(x, row)), row]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "task_members" }, (p) => {
        if (p.eventType === "DELETE") { const id = gone(p); setMembers((l) => l.filter((x) => x.id !== id)); return; }
        setMembers((l) => upsert(l, p.new as Member));
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => { sb.removeChannel(ch); };
  }, [sb]);

  const sortedMembers = useMemo(() => [...members].sort((a, b) => jobRank(a.job_title) - jobRank(b.job_title) || a.sort - b.sort), [members]);
  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.sort - b.sort), [columns]);
  const memberColor = (id: string | null) => {
    const i = sortedMembers.findIndex((m) => m.id === id);
    return i < 0 ? "#64748b" : MEMBER_COLORS[i % MEMBER_COLORS.length];
  };
  const isMine = (t: Card | Item) => (t.assignee_id ? t.assignee_id === myMemberId : t.created_by === meId);
  const pass = (t: Card | Item) => (filter === "all" ? true : filter === "mine" ? isMine(t) : t.assignee_id === filter);
  const laterColumn = sortedColumns.find((c) => c.is_later);
  const newAssignee = filter !== "mine" && filter !== "all" ? filter : myMemberId;   // 다른 멤버를 보고 있으면 그 멤버에게

  // ── 카드 · 세부 항목 ─────────────────────────────────────
  async function addCard(columnId: string, title: string, extra: Partial<Card> = {}) {
    const sort = Math.max(0, ...cards.filter((c) => c.column_id === columnId).map((c) => c.sort)) + 1;
    const { data, error } = await sb.from("todo_cards").insert({ column_id: columnId, title, assignee_id: newAssignee, created_by: meId, sort, ...extra }).select(CARD_COLS).single();
    if (error || !data) { fail("할 일을 추가하지 못했습니다."); return false; }
    setCards((l) => upsert(l, data as Card));
    return true;
  }
  async function addItem(cardId: string, title: string) {
    const card = cards.find((c) => c.id === cardId);
    const sort = Math.max(0, ...items.filter((i) => i.card_id === cardId).map((i) => i.sort)) + 1;
    const { data, error } = await sb.from("todo_items").insert({ card_id: cardId, title, assignee_id: card?.assignee_id ?? newAssignee, created_by: meId, sort }).select(ITEM_COLS).single();
    if (error || !data) { fail("세부 항목을 추가하지 못했습니다."); return false; }
    setItems((l) => upsert(l, data as Item));
    return true;
  }
  async function patchCard(id: string, p: Partial<Card>) {
    const before = cards;
    setCards((l) => l.map((c) => (c.id === id ? { ...c, ...p } : c)));   // 화면 먼저 반영
    const { error } = await sb.from("todo_cards").update(p).eq("id", id);
    if (error) { setCards(before); fail("저장하지 못했습니다."); return false; }
    return true;
  }
  async function patchItem(id: string, p: Partial<Item>) {
    const before = items;
    setItems((l) => l.map((i) => (i.id === id ? { ...i, ...p } : i)));
    const { error } = await sb.from("todo_items").update(p).eq("id", id);
    if (error) { setItems(before); fail("저장하지 못했습니다."); return false; }
    return true;
  }
  // 완료 표시: done 만 보내면 완료 시각은 DB가 채운다. 화면에는 바로 지금 시각으로 보인다
  function toggle(kind: Kind, id: string) {
    const t = kind === "card" ? cards.find((c) => c.id === id) : items.find((i) => i.id === id);
    if (!t) return;
    const doneAt = t.done ? null : new Date().toISOString();
    if (kind === "card") {
      setCards((l) => l.map((c) => (c.id === id ? { ...c, done: !t.done, done_at: doneAt } : c)));
      sb.from("todo_cards").update({ done: !t.done }).eq("id", id).then(({ error }) => { if (error) { setCards((l) => l.map((c) => (c.id === id ? t as Card : c))); fail("저장하지 못했습니다."); } });
    } else {
      setItems((l) => l.map((i) => (i.id === id ? { ...i, done: !t.done, done_at: doneAt } : i)));
      sb.from("todo_items").update({ done: !t.done }).eq("id", id).then(({ error }) => { if (error) { setItems((l) => l.map((i) => (i.id === id ? t as Item : i))); fail("저장하지 못했습니다."); } });
    }
  }
  async function removeCard(id: string) {
    const { error } = await sb.from("todo_cards").delete().eq("id", id);
    if (error) { fail("삭제하지 못했습니다."); return false; }
    setCards((l) => l.filter((c) => c.id !== id)); setItems((l) => l.filter((i) => i.card_id !== id));
    return true;
  }
  async function removeItem(id: string) {
    const { error } = await sb.from("todo_items").delete().eq("id", id);
    if (error) { fail("삭제하지 못했습니다."); return false; }
    setItems((l) => l.filter((i) => i.id !== id));
    return true;
  }

  // ── 열 ───────────────────────────────────────────────
  async function addColumn(name: string, color: string) {
    const later = sortedColumns.filter((c) => c.is_later);
    // 새 열은 "나중에" 열 앞에 놓는다
    const sort = later.length ? later[0].sort : Math.max(0, ...columns.map((c) => c.sort)) + 1;
    if (later.length) for (const c of later) await sb.from("todo_columns").update({ sort: c.sort + 1 }).eq("id", c.id);
    const { data, error } = await sb.from("todo_columns").insert({ name, color, sort, created_by: meId }).select("id, name, color, is_later, sort").single();
    if (error || !data) { fail("열을 추가하지 못했습니다."); return false; }
    setColumns((l) => upsert(l.map((c) => (c.is_later ? { ...c, sort: c.sort + 1 } : c)), data as Column));
    return true;
  }
  async function patchColumn(id: string, p: Partial<Column>) {
    const before = columns;
    setColumns((l) => l.map((c) => (c.id === id ? { ...c, ...p } : c)));
    const { error } = await sb.from("todo_columns").update(p).eq("id", id);
    if (error) { setColumns(before); fail("열을 저장하지 못했습니다."); return false; }
    return true;
  }
  // 옆 열과 순서 바꾸기
  async function moveColumn(id: string, dir: -1 | 1) {
    const i = sortedColumns.findIndex((c) => c.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= sortedColumns.length) return;
    const a = sortedColumns[i], b = sortedColumns[j];
    const [sa, sb2] = a.sort === b.sort ? [b.sort + dir, a.sort] : [b.sort, a.sort];
    setColumns((l) => l.map((c) => (c.id === a.id ? { ...c, sort: sa } : c.id === b.id ? { ...c, sort: sb2 } : c)));
    const r = await Promise.all([sb.from("todo_columns").update({ sort: sa }).eq("id", a.id), sb.from("todo_columns").update({ sort: sb2 }).eq("id", b.id)]);
    if (r.some((x) => x.error)) fail("열 순서를 저장하지 못했습니다.");
  }
  async function removeColumn(c: Column) {
    if (cards.some((k) => k.column_id === c.id)) return fail("카드가 남아 있는 열은 삭제할 수 없습니다. 카드를 다른 열로 옮기거나 지운 뒤 다시 해 주세요.");
    if (!await ask(`‘${c.name}’ 열을 삭제할까요?`)) return;
    const { data, error } = await sb.from("todo_columns").delete().eq("id", c.id).select("id");
    if (error || !data?.length) return fail(error ? "열을 삭제하지 못했습니다. (최근 30일 이전에 완료된 카드가 남아 있을 수 있습니다)" : "열 삭제는 오너 · 관리자만 할 수 있습니다.");
    setColumns((l) => l.filter((x) => x.id !== c.id));
    toast(`‘${c.name}’ 열을 삭제했습니다.`);
  }

  // ── 루틴 ─────────────────────────────────────────────
  const canEditRoutine = (r: Routine) => isAdmin || members.some((m) => m.id === r.owner_id && m.user_id === meId);
  async function addRoutine(title: string) {
    if (!myMemberId) { fail("멤버 정보를 찾지 못해 루틴을 추가할 수 없습니다."); return false; }
    const sort = Math.max(0, ...routines.filter((r) => r.owner_id === myMemberId).map((r) => r.sort)) + 1;
    const { data, error } = await sb.from("todo_routines").insert({ owner_id: myMemberId, title, sort, created_by: meId }).select(ROUTINE_COLS).single();
    if (error || !data) { fail("루틴을 추가하지 못했습니다."); return false; }
    setRoutines((l) => upsert(l, data as Routine));
    return true;
  }
  async function renameRoutine(r: Routine, title: string) {
    setRoutines((l) => l.map((x) => (x.id === r.id ? { ...x, title } : x)));
    const { error } = await sb.from("todo_routines").update({ title }).eq("id", r.id);
    if (error) { setRoutines((l) => l.map((x) => (x.id === r.id ? r : x))); fail("루틴을 저장하지 못했습니다."); }
  }
  async function removeRoutine(r: Routine) {
    if (!await ask(`‘${r.title}’ 루틴을 삭제할까요?\n연속 기록도 함께 삭제됩니다.`)) return;
    const { error } = await sb.from("todo_routines").delete().eq("id", r.id);
    if (error) return fail("루틴을 삭제하지 못했습니다.");
    setRoutines((l) => l.filter((x) => x.id !== r.id)); setLogs((l) => l.filter((x) => x.routine_id !== r.id));
  }
  // 오늘 기록: done(완료) · skip(오늘은 안 함, 연속 유지) · null(기록 지움)
  async function setRoutineLog(r: Routine, status: RoutineLog["status"] | null) {
    const key = { routine_id: r.id, on_date: today };
    const before = logs;
    setLogs((l) => [...l.filter((x) => !sameLog(x, key)), ...(status ? [{ ...key, status }] : [])]);
    const { error } = status
      ? await sb.from("todo_routine_logs").upsert({ ...key, status }, { onConflict: "routine_id,on_date" })
      : await sb.from("todo_routine_logs").delete().eq("routine_id", r.id).eq("on_date", today);
    if (error) { setLogs(before); fail("루틴 기록을 저장하지 못했습니다."); return; }
    if (status === "skip") toast("오늘은 안 함으로 기록했습니다. 연속 기록은 유지됩니다.", { undo: () => setRoutineLog(r, null) });
  }

  function changeView(v: "today" | "board") {
    setView(v);
    window.history.replaceState(null, "", v === "board" ? "?view=board" : window.location.pathname);
  }

  const ctx: Todo = {
    today, meId, myMemberId, isAdmin, members: sortedMembers, columns: sortedColumns, cards, items, routines, logs, clients,
    filter, memberColor, pass, laterColumn, open: (kind, id) => setDetail({ kind, id }),
    addCard, addItem, patchCard, patchItem, toggle, removeCard, removeItem,
    addColumn, patchColumn, moveColumn, removeColumn,
    canEditRoutine, addRoutine, renameRoutine, removeRoutine, setRoutineLog,
  };
  const others = sortedMembers.filter((m) => m.id !== myMemberId);

  return (
    <TodoCtx.Provider value={ctx}>
      <div className="td-top">
        <div className="td-seg" role="tablist" aria-label="할일 화면">
          <button type="button" role="tab" aria-selected={view === "today"} className={view === "today" ? "on" : ""} onClick={() => changeView("today")}>☀ 오늘</button>
          <button type="button" role="tab" aria-selected={view === "board"} className={view === "board" ? "on" : ""} onClick={() => changeView("board")}>▦ 보드</button>
        </div>
        <span className="td-date">{longDate(today)}</span>
        <span className={`live-dot ${live ? "on" : ""}`} title={live ? "다른 직원의 변경이 바로 반영됩니다" : "연결 중"}>{live ? "실시간" : "연결 중"}</span>
        <div className="td-filter" role="group" aria-label="담당자 필터">
          <button type="button" className={filter === "mine" ? "on" : ""} aria-pressed={filter === "mine"} onClick={() => setFilter("mine")}>내 할 일</button>
          <button type="button" className={filter === "all" ? "on" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>전체</button>
          {others.map((m) => <button key={m.id} type="button" className={filter === m.id ? "on" : ""} aria-pressed={filter === m.id} onClick={() => setFilter(m.id)}>{m.name}</button>)}
        </div>
      </div>

      {view === "today" ? <TodayView /> : <BoardView />}
      {detail && <Detail key={`${detail.kind}-${detail.id}`} kind={detail.kind} id={detail.id} onClose={() => setDetail(null)} />}
    </TodoCtx.Provider>
  );
}

