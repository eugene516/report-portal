"use client";
// 할 일 상세 창: 제목 · 담당 · 카테고리 · 우선순위 · 광고주 · 마감일 · ☀ 오늘 · 메모 · 담당자 변경 기록 · 삭제 · 저장
// 담당자 변경 기록은 DB 트리거가 남긴다(화면은 읽기만)
import { useEffect, useRef, useState } from "react";
import { ask, toast } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useTodo, type Kind } from "./ctx";
import { Avatar } from "./views";
import { PRI, addDays, kstStamp, md, nextMonday, thisFriday, type Card, type History, type Item } from "./types";

export default function Detail({ kind, id, onClose }: { kind: Kind; id: string; onClose: () => void }) {
  const { today, myMemberId, members, columns, cards, items, clients, patchCard, patchItem, removeCard, removeItem } = useTodo();
  const t = kind === "card" ? cards.find((c) => c.id === id) : items.find((i) => i.id === id);
  const parent = kind === "item" ? cards.find((c) => c.id === (t as Item | undefined)?.card_id) : undefined;
  const card = kind === "card" ? (t as Card | undefined) : undefined;

  const [title, setTitle] = useState(t?.title ?? "");
  const [assignee, setAssignee] = useState<string | null>(t?.assignee_id ?? null);
  const [columnId, setColumnId] = useState(card?.column_id ?? "");
  const [priority, setPriority] = useState(card?.priority ?? 0);
  const [clientId, setClientId] = useState(card?.client_id ?? "");
  const [due, setDue] = useState(t?.due_on ?? "");
  const [todayOn, setTodayOn] = useState<string | null>(t?.today_on ?? null);
  const [note, setNote] = useState(t?.note ?? "");
  const [hist, setHist] = useState<History[] | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // 담당자 변경 기록 (최근 20건)
  useEffect(() => {
    const sb = supabaseBrowser();
    sb.from("todo_history").select("id, at, title, actor_name, from_name, to_name")
      .eq(kind === "card" ? "card_id" : "item_id", id).order("at", { ascending: false }).limit(20)
      .then(({ data }) => setHist((data ?? []) as History[]));
  }, [kind, id]);
  useEffect(() => { panel.current?.querySelector<HTMLInputElement>("#td-d-title")?.focus(); }, []);

  if (!t) return null;   // 다른 직원이 지운 경우
  const tomorrow = addDays(today, 1);
  const dueChips = [["오늘", today], ["내일", tomorrow], ["이번 주 금", thisFriday(today)], ["다음 주 월", nextMonday(today)]] as const;
  const col = columns.find((c) => c.id === (card?.column_id ?? parent?.column_id));

  async function save() {
    const v = title.trim();
    if (!v) return;
    const base = { title: v, assignee_id: assignee, due_on: due || null, today_on: todayOn, note: note.trim() || null };
    const p: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(base)) if ((t as unknown as Record<string, unknown>)[k] !== val) p[k] = val;
    if (card) {
      if (columnId !== card.column_id) p.column_id = columnId;
      if (priority !== card.priority) p.priority = priority;
      if ((clientId || null) !== card.client_id) p.client_id = clientId || null;
    }
    if (Object.keys(p).length === 0) return onClose();
    setBusy(true);
    const ok = kind === "card" ? await patchCard(id, p as Partial<Card>) : await patchItem(id, p as Partial<Item>);
    setBusy(false);
    if (!ok) return;
    if ("assignee_id" in p) {
      const who = members.find((m) => m.id === assignee)?.name;
      toast(who ? `${who}에게 맡겼습니다.` : "담당자를 비웠습니다.");
    } else toast("저장했습니다.");
    onClose();
  }
  async function del() {
    const n = kind === "card" ? items.filter((i) => i.card_id === id).length : 0;
    if (!await ask(`‘${t!.title.slice(0, 30)}’을(를) 삭제할까요?${n ? `\n세부 항목 ${n}건도 함께 삭제됩니다.` : ""}`)) return;
    setBusy(true);
    const ok = kind === "card" ? await removeCard(id) : await removeItem(id);
    setBusy(false);
    if (ok) { toast("삭제했습니다."); onClose(); }
  }

  return (
    <div className="td-dim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="td-sheet" role="dialog" aria-modal="true" aria-label="할 일 상세" ref={panel}>
        <h3>{kind === "card" ? "카드" : "세부 항목"} 상세{card?.auto && <span className="td-badge auto">자동</span>}</h3>
        <form className="td-frm" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label htmlFor="td-d-title">제목</label>
          <input id="td-d-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required />

          <span className="td-lbl">담당자</span>
          <div className="td-chips" role="radiogroup" aria-label="담당자">
            {members.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={assignee === m.id} className={`td-chip${assignee === m.id ? " on" : ""}`} onClick={() => setAssignee(m.id)}>
                <Avatar id={m.id} /> {m.name}{m.id === myMemberId ? " (나)" : ""}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={!assignee} className={`td-chip${!assignee ? " on" : ""}`} onClick={() => setAssignee(null)}>담당자 없음</button>
          </div>

          <label htmlFor="td-d-col">카테고리</label>
          {card
            ? <select id="td-d-col" value={columnId} onChange={(e) => setColumnId(e.target.value)}>{columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            : <input id="td-d-col" value={`${col?.name ?? ""} › ${parent?.title ?? ""}`} disabled />}

          {card && (
            <>
              <label htmlFor="td-d-pri">우선순위</label>
              <select id="td-d-pri" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>{PRI.map((p, i) => <option key={p} value={i}>{p}</option>)}</select>
              <label htmlFor="td-d-client">광고주</label>
              <select id="td-d-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">없음</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </>
          )}

          <label htmlFor="td-d-due">마감일</label>
          <div>
            <input id="td-d-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="td-date-in" />
            <div className="td-chips mt">
              {dueChips.map(([label, d]) => <button key={label} type="button" className={`td-chip${due === d ? " on" : ""}`} onClick={() => setDue(d)}>{label} <span className="td-chip-d">{md(d)}</span></button>)}
              <button type="button" className={`td-chip${!due ? " on" : ""}`} onClick={() => setDue("")}>없음</button>
            </div>
          </div>

          <span className="td-lbl">☀ 오늘</span>
          <div className="td-chips" role="radiogroup" aria-label="☀ 오늘 표시">
            <button type="button" role="radio" aria-checked={todayOn === today} className={`td-chip${todayOn === today ? " on" : ""}`} onClick={() => setTodayOn(today)}>오늘</button>
            <button type="button" role="radio" aria-checked={todayOn === tomorrow} className={`td-chip${todayOn === tomorrow ? " on" : ""}`} onClick={() => setTodayOn(tomorrow)}>내일</button>
            {todayOn && todayOn !== today && todayOn !== tomorrow && <button type="button" role="radio" aria-checked className="td-chip on">{md(todayOn)}</button>}
            <button type="button" role="radio" aria-checked={!todayOn} className={`td-chip${!todayOn ? " on" : ""}`} onClick={() => setTodayOn(null)}>표시 없음</button>
          </div>

          <label htmlFor="td-d-memo">내용</label>
          <textarea id="td-d-memo" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} placeholder="메모" />
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>

        <div className="td-hist">
          {hist === null ? <span>담당자 변경 기록 불러오는 중…</span>
            : hist.length === 0 ? <span>담당자 변경 기록 없음</span>
            : hist.map((h) => (
              <span key={h.id}>{kstStamp(h.at)} · {h.actor_name ?? "자동 등록"}: {h.from_name ? `${h.from_name} → ` : ""}{h.to_name ?? "담당자 없음"}에게 맡김</span>
            ))}
        </div>

        <div className="td-foot">
          <button type="button" className="btn sm td-danger" onClick={del} disabled={busy}>삭제</button>
          <span className="td-sp" />
          <button type="button" className="btn sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn sm primary" onClick={save} disabled={busy || !title.trim()}>저장</button>
        </div>
      </div>
    </div>
  );
}
