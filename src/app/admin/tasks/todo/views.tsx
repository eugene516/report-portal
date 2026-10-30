"use client";
// 할일 화면 본문: 오늘 · 보드 · 한 줄(카드/세부 항목)
import { useState } from "react";
import { useTodo, type Kind } from "./ctx";
import { PRI, addDays, kstOf, md, streak, type Card, type Column, type Item, type Routine } from "./types";

// ── 공통 ────────────────────────────────────────────────
export function Avatar({ id, mine }: { id: string | null; mine?: boolean }) {
  const { members, memberColor, myMemberId } = useTodo();
  if (!id) return <span className="td-av none" title="담당자 없음">·</span>;
  const m = members.find((x) => x.id === id);
  return (
    <span className={`td-av${mine && id === myMemberId ? " mine" : ""}`} style={{ "--m": memberColor(id) } as React.CSSProperties} title={`담당 ${m?.name ?? "(삭제된 멤버)"}`}>
      {(m?.name ?? "?").slice(0, 2)}
    </span>
  );
}

function Badges({ t, card }: { t: Card | Item; card?: Card }) {
  const { today, clients } = useTodo();
  const client = card && clients.find((c) => c.id === card.client_id);
  return (
    <>
      {t.due_on && t.due_on < today && !t.done
        ? <span className="td-badge late">마감 {md(t.due_on)} 지남</span>
        : t.due_on && <span className="td-badge">마감 {md(t.due_on)}</span>}
      {t.today_on === today && <span className="td-badge sun">☀ 오늘</span>}
      {t.today_on && t.today_on > today && <span className="td-badge sun">☀ {t.today_on === addDays(today, 1) ? "내일" : md(t.today_on)}</span>}
      {card && card.priority > 0 && <span className={`td-badge pri p${card.priority}`}>{PRI[card.priority]}</span>}
      {client && <span className="td-badge">{client.name}</span>}
      {card?.auto && <span className="td-badge auto" title="계약 마감 3일 전 자동 등록">자동</span>}
      {t.note && <span className="td-badge" title={t.note}>메모</span>}
    </>
  );
}

// 한 줄: 카드 또는 세부 항목. 제목을 누르면 상세 창
export function TaskRow({ kind, t, parent, acts, context = true }: { kind: Kind; t: Card | Item; parent?: Card; acts?: React.ReactNode; context?: boolean }) {
  const { columns, items, toggle, open } = useTodo();
  const card = kind === "card" ? (t as Card) : parent;
  const col = columns.find((c) => c.id === card?.column_id);
  const sub = kind === "card" ? items.filter((i) => i.card_id === t.id) : [];
  return (
    <div className={`td-row${t.done ? " done" : ""}`}>
      <button type="button" className={`td-check${t.done ? " on" : ""}`} aria-label={t.done ? "완료 취소" : "완료"} title={t.done ? "완료 취소" : "완료"} onClick={() => toggle(kind, t.id)}>{t.done ? "✓" : ""}</button>
      <div className="td-body">
        <button type="button" className={`td-title${kind === "card" ? " card" : ""}`} style={{ "--c": col?.color ?? "var(--accent)" } as React.CSSProperties} onClick={() => open(kind, t.id)}>{t.title}</button>
        {sub.length > 0 && <span className="td-badge">{sub.filter((i) => !i.done).length}/{sub.length}</span>}
        <div className="td-sub">
          <Avatar id={t.assignee_id} mine />
          {context && <span className="td-ctx">{kind === "card" ? col?.name : parent?.title}</span>}
          <Badges t={t} card={kind === "card" ? (t as Card) : undefined} />
        </div>
      </div>
      <div className="td-acts">
        {acts}
        <button type="button" className="td-ib" title="담당자 바꾸기 · 상세" aria-label="상세" onClick={() => open(kind, t.id)}>👤</button>
      </div>
    </div>
  );
}

const Empty = () => <div className="td-empty">없음</div>;

// 한 줄 입력(Enter로 추가, Esc로 닫기)
// always: 버튼 없이 입력창을 늘 보여준다 (오늘 할 일 · 루틴)
function AddInline({ label, placeholder, onAdd, max = 300, className = "td-add", always = false }: { label: string; placeholder: string; onAdd: (v: string) => Promise<boolean>; max?: number; className?: string; always?: boolean }) {
  const [open, setOpen] = useState(always);
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form className="td-addform" onSubmit={async (e) => {
      e.preventDefault();
      const t = v.trim();
      if (!t || busy) return;
      setBusy(true);
      if (await onAdd(t)) setV("");
      setBusy(false);
    }}>
      <input value={v} onChange={(e) => setV(e.target.value)} maxLength={max} placeholder={placeholder} aria-label={placeholder}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(always); setV(""); } }} autoFocus={!always} />
      <button className="btn sm primary" disabled={busy || !v.trim()}>추가</button>
      {!always && <button type="button" className="btn sm" onClick={() => { setOpen(false); setV(""); }}>닫기</button>}
    </form>
  );
}

// ── 오늘 ────────────────────────────────────────────────
type Entry = { kind: Kind; t: Card | Item; parent?: Card };

export function TodayView() {
  const { today, cards, items, routines, logs, filter, myMemberId, pass, laterColumn, patchCard, patchItem, addRoutine, addCard, columns } = useTodo();
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const firstColumn = [...columns].sort((a, b) => a.sort - b.sort).find((c) => !c.is_later);
  // 세부 항목이 없는 카드는 카드 한 줄, 있으면 세부 항목마다 한 줄
  const all: Entry[] = [];
  for (const k of cards) if (!items.some((i) => i.card_id === k.id)) all.push({ kind: "card", t: k });
  for (const i of items) { const k = cardById.get(i.card_id); if (k) all.push({ kind: "item", t: i, parent: k }); }
  const mine = all.filter((x) => pass(x.t));
  const openOnes = mine.filter((x) => !x.t.done && !(x.parent?.done));
  const leftovers = openOnes.filter((x) => x.t.today_on && x.t.today_on < today);
  const todays = openOnes
    .filter((x) => !(x.t.today_on && x.t.today_on < today) && ((x.t.due_on && x.t.due_on <= today) || x.t.today_on === today))
    .sort((a, b) => (a.t.due_on ?? "9999").localeCompare(b.t.due_on ?? "9999")
      || ((b.kind === "card" ? (b.t as Card).priority : b.parent?.priority ?? 0) - (a.kind === "card" ? (a.t as Card).priority : a.parent?.priority ?? 0)));
  const doneToday = mine.filter((x) => x.t.done && x.t.done_at && kstOf(x.t.done_at) === today);

  const logMap = new Map<string, Map<string, "done" | "skip">>();
  for (const l of logs) { if (!logMap.has(l.routine_id)) logMap.set(l.routine_id, new Map()); logMap.get(l.routine_id)!.set(l.on_date, l.status); }
  const shown = routines.filter((r) => (filter === "all" ? true : filter === "mine" ? r.owner_id === myMemberId : r.owner_id === filter));
  const todayOf = (r: Routine) => logMap.get(r.id)?.get(today);
  const active = shown.filter((r) => todayOf(r) !== "skip");
  const routinesDone = shown.filter((r) => todayOf(r) === "done");

  // 어제 못 한 일 옮기기: ☀ 오늘로 · → 내일로 · ⏳ 나중에(카드는 "나중에" 열로)
  const move = (x: Entry, to: "today" | "tomorrow" | "later") => {
    const today_on = to === "today" ? today : to === "tomorrow" ? addDays(today, 1) : null;
    if (x.kind === "item") return patchItem(x.t.id, { today_on });
    return patchCard(x.t.id, to === "later" && laterColumn ? { today_on, column_id: laterColumn.id } : { today_on });
  };
  const moveActs = (x: Entry) => (
    <>
      <button type="button" className="td-ib" title="오늘로" aria-label="오늘로" onClick={() => move(x, "today")}>☀</button>
      <button type="button" className="td-ib" title="내일로" aria-label="내일로" onClick={() => move(x, "tomorrow")}>→</button>
      <button type="button" className="td-ib" title="나중에" aria-label="나중에" onClick={() => move(x, "later")}>⏳</button>
    </>
  );
  const list = (l: Entry[], acts?: (x: Entry) => React.ReactNode) =>
    l.length ? l.map((x) => <TaskRow key={`${x.kind}-${x.t.id}`} kind={x.kind} t={x.t} parent={x.parent} acts={acts?.(x)} />) : <Empty />;

  return (
    <div className="td-today">
      <section className="td-sec">
        <h2>어제 못 한 일 <span className="n">{leftovers.length}</span></h2>
        {list(leftovers, moveActs)}
      </section>
      <section className="td-sec">
        <h2>☀ 오늘 할 일 <span className="n">{todays.length}</span></h2>
        {list(todays)}
        {/* 오늘 할 일 바로 추가: '나중에'가 아닌 첫 열에 ☀ 오늘 표시로 만든다 */}
        {firstColumn && <AddInline always label="" placeholder="오늘 할 일 입력 후 Enter" onAdd={(t) => addCard(firstColumn.id, t, { today_on: today })} />}
      </section>
      <section className="td-sec">
        <h2>루틴 <span className="n">{active.length}</span></h2>
        {active.length ? active.map((r) => <RoutineRow key={r.id} r={r} done={todayOf(r) === "done"} days={streak(r, logMap.get(r.id) ?? new Map(), today)} />) : <Empty />}
        {filter === "mine" && myMemberId && <AddInline always label="" placeholder="매일 할 루틴 입력 후 Enter (예: 아침 메일 확인)" max={100} onAdd={addRoutine} />}
      </section>
      <section className="td-sec">
        <h2>오늘 완료 <span className="n">{doneToday.length + routinesDone.length}</span></h2>
        {doneToday.length + routinesDone.length === 0 && <Empty />}
        {doneToday.map((x) => <TaskRow key={`${x.kind}-${x.t.id}`} kind={x.kind} t={x.t} parent={x.parent} />)}
        {routinesDone.map((r) => (
          <div key={r.id} className="td-row done">
            <span className="td-check on" aria-hidden="true">✓</span>
            <div className="td-body"><span className="td-title static">{r.title}</span><div className="td-sub"><span className="td-badge">루틴</span></div></div>
          </div>
        ))}
      </section>
    </div>
  );
}

function RoutineRow({ r, done, days }: { r: Routine; done: boolean; days: number }) {
  const { canEditRoutine, setRoutineLog, renameRoutine, removeRoutine } = useTodo();
  const editable = canEditRoutine(r);
  const [editing, setEditing] = useState(false);
  return (
    <div className={`td-row${done ? " done" : ""}`}>
      <button type="button" className={`td-check${done ? " on" : ""}`} disabled={!editable} aria-label={done ? "완료 취소" : "완료"} title={editable ? (done ? "완료 취소" : "완료") : "루틴 주인만 기록할 수 있습니다"}
        onClick={() => setRoutineLog(r, done ? null : "done")}>{done ? "✓" : ""}</button>
      <div className="td-body">
        {editing ? (
          <form className="td-addform" onSubmit={(e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("t") ?? "").trim();
            if (v && v !== r.title) renameRoutine(r, v);
            setEditing(false);
          }}>
            <input name="t" autoFocus defaultValue={r.title} maxLength={100} aria-label="루틴 이름" onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }} />
            <button className="btn sm primary">저장</button>
          </form>
        ) : editable
          ? <button type="button" className="td-title" onClick={() => setEditing(true)} title="이름 바꾸기">{r.title}</button>
          : <span className="td-title static">{r.title}</span>}
        <div className="td-sub"><Avatar id={r.owner_id} mine /><span className="td-streak">🔥 {days}일 연속</span></div>
      </div>
      {editable && (
        <div className="td-acts">
          {!done && <button type="button" className="td-ib" title="오늘은 안 함 (연속 유지)" aria-label="오늘은 안 함" onClick={() => setRoutineLog(r, "skip")}>－</button>}
          <button type="button" className="td-ib" title="루틴 삭제" aria-label="루틴 삭제" onClick={() => removeRoutine(r)}>🗑</button>
        </div>
      )}
    </div>
  );
}

// ── 보드 ────────────────────────────────────────────────
export function BoardView() {
  const { columns, addColumn } = useTodo();
  return (
    <div className="td-board">
      {columns.map((c, i) => <ColumnView key={c.id} c={c} first={i === 0} last={i === columns.length - 1} />)}
      <section className="td-col td-col-new">
        <NewColumn onAdd={addColumn} />
      </section>
    </div>
  );
}

const COLORS = ["#dc2626", "#ea580c", "#ca8a04", "#059669", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#6b7280"];

function NewColumn({ onAdd }: { onAdd: (name: string, color: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(COLORS[5]);
  if (!open) return <button type="button" className="td-add" onClick={() => setOpen(true)}>+ 열 추가</button>;
  return (
    <form className="td-colform" onSubmit={async (e) => {
      e.preventDefault();
      const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
      if (name && await onAdd(name, color)) setOpen(false);
    }}>
      <input name="name" autoFocus maxLength={40} placeholder="열 이름" aria-label="열 이름" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      <ColorPick value={color} onChange={setColor} />
      <div className="row"><button className="btn sm primary">추가</button><button type="button" className="btn sm" onClick={() => setOpen(false)}>취소</button></div>
    </form>
  );
}

function ColorPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="td-colors" role="radiogroup" aria-label="열 색">
      {COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} className={value === c ? "on" : ""} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

function ColumnView({ c, first, last }: { c: Column; first: boolean; last: boolean }) {
  const { cards, items, pass, isAdmin, addCard, patchCard, patchColumn, moveColumn, removeColumn } = useTodo();
  const [menu, setMenu] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [over, setOver] = useState(false);
  const [color, setColor] = useState(c.color);
  const ks = cards.filter((k) => k.column_id === c.id && (pass(k) || items.some((i) => i.card_id === k.id && pass(i))));
  const open = ks.filter((k) => !k.done).sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
  const done = ks.filter((k) => k.done).sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));

  return (
    <section className={`td-col${c.is_later ? " later" : ""}${over ? " drop" : ""}`} style={{ "--c": c.color } as React.CSSProperties}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("text/todo-card")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const id = e.dataTransfer.getData("text/todo-card"); if (id) { e.preventDefault(); patchCard(id, { column_id: c.id }); } }}>
      <header>
        <span className="td-dot" aria-hidden="true">{c.is_later ? "◇" : "◆"}</span>
        <span className="nm" title={c.name}>{c.name}</span>
        <span className="n">{open.length}</span>
        <button type="button" className="td-ib" title="열 메뉴" aria-label={`${c.name} 열 메뉴`} aria-expanded={menu} onClick={() => { setMenu(!menu); setColor(c.color); }}>⋯</button>
      </header>
      {menu && (
        <form className="td-colform" onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const name = String(fd.get("name") ?? "").trim();
          if (!name) return;
          if (await patchColumn(c.id, { name, color, is_later: fd.get("later") === "on" })) setMenu(false);
        }}>
          <input name="name" defaultValue={c.name} maxLength={40} aria-label="열 이름" />
          <ColorPick value={color} onChange={setColor} />
          <label className="td-check-label"><input type="checkbox" name="later" defaultChecked={c.is_later} /> ‘나중에’ 열 (⏳ 버튼이 카드를 이 열로 옮김)</label>
          <div className="row">
            <button type="button" className="btn sm" disabled={first} onClick={() => moveColumn(c.id, -1)} aria-label="왼쪽으로">←</button>
            <button type="button" className="btn sm" disabled={last} onClick={() => moveColumn(c.id, 1)} aria-label="오른쪽으로">→</button>
            <span className="td-sp" />
            {isAdmin && <button type="button" className="btn sm td-danger" onClick={() => removeColumn(c)}>삭제</button>}
            <button className="btn sm primary">저장</button>
          </div>
        </form>
      )}
      <div className="td-cards">
        {open.map((k) => <CardView key={k.id} k={k} />)}
        <AddInline label="+ 할 일 추가" placeholder="할 일 제목" onAdd={(t) => addCard(c.id, t)} />
      </div>
      {done.length > 0 && (
        <>
          <button type="button" className="td-fold" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>완료됨 ({done.length}) {showDone ? "▾" : "▸"}</button>
          {showDone && <div className="td-cards">{done.map((k) => <CardView key={k.id} k={k} />)}</div>}
        </>
      )}
    </section>
  );
}

function CardView({ k }: { k: Card }) {
  const { items, addItem } = useTodo();
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const sub = items.filter((i) => i.card_id === k.id).sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
  const openSub = sub.filter((i) => !i.done), doneSub = sub.filter((i) => i.done);
  return (
    <div className={`td-card${k.done ? " done" : ""}`} draggable={!k.done}
      onDragStart={(e) => { e.dataTransfer.setData("text/todo-card", k.id); e.dataTransfer.effectAllowed = "move"; }}>
      <TaskRow kind="card" t={k} context={false}
        acts={!k.done && <button type="button" className="td-ib" title="세부 항목 추가" aria-label="세부 항목 추가" onClick={() => setAdding(!adding)}>＋</button>} />
      {(sub.length > 0 || adding) && (
        <div className="td-items">
          {openSub.map((i) => <TaskRow key={i.id} kind="item" t={i} parent={k} context={false} />)}
          {doneSub.length > 0 && <button type="button" className="td-fold sm" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>완료 {doneSub.length} {showDone ? "▴" : "▾"}</button>}
          {showDone && doneSub.map((i) => <TaskRow key={i.id} kind="item" t={i} parent={k} context={false} />)}
          {adding && <ItemAdd onAdd={(t) => addItem(k.id, t)} onClose={() => setAdding(false)} />}
        </div>
      )}
    </div>
  );
}

function ItemAdd({ onAdd, onClose }: { onAdd: (t: string) => Promise<boolean>; onClose: () => void }) {
  const [v, setV] = useState("");
  return (
    <form className="td-addform" onSubmit={async (e) => { e.preventDefault(); const t = v.trim(); if (t && await onAdd(t)) setV(""); }}>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={300} placeholder="세부 항목" aria-label="세부 항목"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} />
      <button className="btn sm primary" disabled={!v.trim()}>추가</button>
    </form>
  );
}
