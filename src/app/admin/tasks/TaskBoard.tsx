"use client";
// 업무 확인 보드: 멤버별 열(가로) · 업무 목록(세로)
// - 열 위쪽 입력창: 업무 추가(Enter). 입력하면 업무일 · 광고주 · 반복을 고를 수 있다(기본 오늘)
// - 업무에 마우스를 올리면 수정(✎) · 삭제(🗑). 수정에서 담당 멤버 · 광고주 · 반복 · 메모를 바꾼다
// - 업무를 끌어 다른 멤버 열에 놓으면 담당이 바뀐다
// - 동그라미를 누르면 완료 → 아래 "완료" 상자로 이동. 반복 업무는 다음 회차가 자동으로 생긴다(DB)
// - 계약 마감 3일 전 항목은 주담당 직원 열에 "자동"으로 올라온다(DB: sync_deadline_tasks)
// - 다른 직원이 바꾼 내용은 실시간으로 반영된다(Supabase Realtime)
// - 상단: 멤버 추가 · 멤버 삭제(오너·관리자)
// 저장은 로그인 세션으로 직접 하며, DB 규칙이 직원 여부·관리자 여부를 다시 확인한다.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ask, toast, toastError } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { JOB_TITLES, jobRank, NEW_JOB_TITLES } from "@/lib/titles";

export type Member = { id: string; name: string; user_id: string | null; sort: number; job_title: string | null; duty: string | null };
export type Task = {
  id: string; member_id: string; title: string; due_on: string | null; done: boolean; done_at: string | null; sort: number; created_at: string;
  client_id: string | null; note: string | null; repeat: "none" | "daily" | "weekly" | "monthly"; auto: boolean;
};
export const TASK_COLS = "id, member_id, title, due_on, done, done_at, sort, created_at, client_id, note, repeat, auto";
type Client = { id: string; name: string };

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const REPEAT = { none: "반복 안 함", daily: "매일", weekly: "매주", monthly: "매월" } as const;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const dayLabel = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

type Board = {
  today: string; members: Member[]; clients: Client[];
  onAdd: (memberId: string, v: Pick<Task, "title" | "due_on" | "client_id" | "repeat">) => Promise<boolean>;
  onToggle: (t: Task) => void; onPatch: (id: string, p: Partial<Task>) => void; onRemove: (t: Task) => void;
};
const Ctx = createContext<Board | null>(null);
const useBoard = () => useContext(Ctx)!;

export default function TaskBoard({ today, meId, canManageMembers, members: initMembers, tasks: initTasks, directory, clients }: {
  today: string; meId: string; canManageMembers: boolean; members: Member[]; tasks: Task[];
  directory: { id: string; name: string; email: string }[]; clients: Client[];
}) {
  const sb = supabaseBrowser();
  const [members, setMembers] = useState(initMembers);
  const [tasks, setTasks] = useState(initTasks);
  // 서버 자료가 바뀌면(다시 열기) 화면 목록도 새 자료로 바꾼다
  const [src, setSrc] = useState({ initMembers, initTasks });
  if (src.initMembers !== initMembers || src.initTasks !== initTasks) {
    setSrc({ initMembers, initTasks }); setMembers(initMembers); setTasks(initTasks);
  }
  const [adding, setAdding] = useState(false);       // 멤버 추가 입력 열림
  const [removing, setRemoving] = useState(false);   // 멤버 삭제 모드
  const [live, setLive] = useState(false);
  const fail = (t: string) => toastError(t);

  // 실시간 반영: 다른 직원이 추가·수정·삭제한 업무와 멤버
  useEffect(() => {
    const ch = sb.channel("team-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_tasks" }, (p) => {
        if (p.eventType === "DELETE") { const id = (p.old as { id?: string }).id; setTasks((l) => l.filter((x) => x.id !== id)); return; }
        const row = p.new as Task;
        setTasks((l) => (l.some((x) => x.id === row.id) ? l.map((x) => (x.id === row.id ? { ...x, ...row } : x)) : [...l, row]));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "task_members" }, (p) => {
        if (p.eventType === "DELETE") { const id = (p.old as { id?: string }).id; setMembers((l) => l.filter((x) => x.id !== id)); return; }
        const row = p.new as Member;
        setMembers((l) => (l.some((x) => x.id === row.id) ? l.map((x) => (x.id === row.id ? { ...x, ...row } : x)) : [...l, row]));
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => { sb.removeChannel(ch); };
  }, [sb]);

  // ── 멤버 ─────────────────────────────────────────────
  async function addMember(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const userId = String(fd.get("user") ?? "");
    const typed = String(fd.get("name") ?? "").trim();
    const name = typed || directory.find((d) => d.id === userId)?.name || "";
    if (!name) return fail("이름을 입력하거나 직원을 선택해 주세요.");
    const title = String(fd.get("title") ?? "") || null, duty = String(fd.get("duty") ?? "").trim() || null;
    const { data, error } = await sb.from("task_members")
      .insert({ name, user_id: userId || null, job_title: title, duty, sort: Math.max(0, ...members.map((m) => m.sort)) + 1, created_by: meId })
      .select("id, name, user_id, sort, job_title, duty").single();
    // 직원 계정과 연결했으면 직원 정보(직급 · 담당 업무)도 같이 맞춘다
    if (!error && userId && (title || duty)) await sb.rpc("set_staff_profile", { p_user: userId, p_name: "", p_title: title ?? "", p_duty: duty ?? "" });
    if (error || !data) return fail("멤버를 추가하지 못했습니다.");
    setMembers((l) => (l.some((x) => x.id === data.id) ? l : [...l, data as Member])); setAdding(false);
    toast(`${name} 멤버를 추가했습니다.`);
  }
  // 멤버 이름 · 직급 · 담당 업무 수정 (오너·관리자). 직원 계정과 연결된 멤버는 직원 정보도 함께 바뀐다
  async function editMember(m: Member, p: { name: string; job_title: string | null; duty: string | null }) {
    const { error } = m.user_id
      ? await sb.rpc("set_staff_profile", { p_user: m.user_id, p_name: p.name, p_title: p.job_title ?? "", p_duty: p.duty ?? "" })
      : await sb.from("task_members").update(p).eq("id", m.id);
    if (error) { fail("멤버 정보를 저장하지 못했습니다."); return false; }
    setMembers((l) => l.map((x) => (x.id === m.id ? { ...x, ...p } : x)));
    return true;
  }
  async function removeMember(m: Member) {
    const n = tasks.filter((t) => t.member_id === m.id && !t.done).length;
    if (!await ask(`${m.name} 멤버를 삭제할까요?${n ? `\n남은 업무 ${n}건과 완료 기록도 함께 삭제됩니다.` : ""}`)) return;
    const { error } = await sb.from("task_members").delete().eq("id", m.id);
    if (error) return fail("멤버를 삭제하지 못했습니다.");
    setMembers((l) => l.filter((x) => x.id !== m.id)); setTasks((l) => l.filter((t) => t.member_id !== m.id));
  }

  // ── 업무 ─────────────────────────────────────────────
  async function addTask(memberId: string, v: Pick<Task, "title" | "due_on" | "client_id" | "repeat">) {
    const { data, error } = await sb.from("team_tasks").insert({ member_id: memberId, ...v, created_by: meId }).select(TASK_COLS).single();
    if (error || !data) { fail("업무를 추가하지 못했습니다."); return false; }
    setTasks((l) => (l.some((x) => x.id === data.id) ? l : [...l, data as Task]));
    return true;
  }
  async function patch(id: string, p: Partial<Task>) {
    const before = tasks;
    setTasks((l) => l.map((t) => (t.id === id ? { ...t, ...p } : t)));   // 화면 먼저 반영
    const { error } = await sb.from("team_tasks").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { setTasks(before); fail("저장하지 못했습니다."); }
  }
  const toggle = (t: Task) => {
    patch(t.id, { done: !t.done, done_at: t.done ? null : new Date().toISOString() });
    if (!t.done && t.repeat !== "none") toast(`${REPEAT[t.repeat]} 반복 업무 — 다음 회차를 만들었습니다.`);
  };
  // 삭제: 바로 목록에서 빼고 5초 동안 [되돌리기]를 보여준 뒤 실제로 지운다
  const pendingDelete = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function remove(t: Task) {
    setTasks((list) => list.filter((x) => x.id !== t.id));
    const timer = setTimeout(async () => {
      pendingDelete.current.delete(t.id);
      const { error } = await sb.from("team_tasks").delete().eq("id", t.id);
      if (error) { setTasks((list) => [...list, t]); fail("삭제하지 못했습니다."); }
    }, 5000);
    pendingDelete.current.set(t.id, timer);
    toast(`“${t.title.slice(0, 20)}” 삭제`, { undo: () => { clearTimeout(pendingDelete.current.get(t.id)); pendingDelete.current.delete(t.id); setTasks((list) => [...list, t]); } });
  }

  const openAll = tasks.filter((t) => !t.done);
  const todayCount = openAll.filter((t) => !t.due_on || t.due_on <= today).length;
  const overdue = openAll.filter((t) => t.due_on && t.due_on < today).length;
  const doneToday = tasks.filter((t) => t.done && t.done_at && new Date(Date.parse(t.done_at) + 9 * 3600_000).toISOString().slice(0, 10) === today).length;
  const unlinked = directory.filter((d) => !members.some((m) => m.user_id === d.id));
  const sorted = [...members].sort((a, b) => jobRank(a.job_title) - jobRank(b.job_title) || a.sort - b.sort);

  return (
    <Ctx.Provider value={{ today, members: sorted, clients, onAdd: addTask, onToggle: toggle, onPatch: patch, onRemove: remove }}>
      <header className="tasks-head">
        <div>
          <div className="faint">믿는구석 · 전체 구성원</div>
          <h1>업무 확인 <span className="h-sub">{dayLabel(today)}</span></h1>
          <div className="faint mt-xs">
            오늘 할 일 {todayCount}건{overdue > 0 && <span className="t-bad"> · 지난 업무 {overdue}건</span>} · 오늘 완료 {doneToday}건
            <span className={`live-dot ${live ? "on" : ""}`} title={live ? "다른 직원의 변경이 바로 반영됩니다" : "연결 중"}>{live ? "실시간" : "연결 중"}</span>
          </div>
        </div>
        {canManageMembers && (
          <div className="row">
            <button className={`btn sm ${adding ? "primary" : ""}`} onClick={() => { setAdding(!adding); setRemoving(false); }}>+ 멤버 추가</button>
            <button className={`btn sm ${removing ? "danger" : ""}`} onClick={() => { setRemoving(!removing); setAdding(false); }}>{removing ? "삭제 끝내기" : "− 멤버 삭제"}</button>
          </div>
        )}
      </header>

      {adding && (
        <form className="card pad member-form" onSubmit={addMember}>
          <label>직원 계정에서 선택<select name="user" defaultValue=""><option value="">(선택 안 함)</option>{unlinked.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.email})</option>)}</select></label>
          <label>또는 이름 입력<input name="name" maxLength={40} className="search" placeholder="예: 디자인팀, 외주 작가" /></label>
          <label>직급<select name="title" defaultValue=""><option value="">선택 안 함</option>{NEW_JOB_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label>담당 업무<input name="duty" maxLength={100} className="search" placeholder="예: 블로그·카페 운영" /></label>
          <button className="btn primary sm">추가</button>
          <button type="button" className="btn sm" onClick={() => setAdding(false)}>취소</button>
        </form>
      )}
      {removing && <div className="notice">삭제할 멤버 이름 옆의 × 를 누르세요. 그 멤버의 업무도 함께 삭제됩니다.</div>}

      <div className="board">
        {members.length === 0 && <div className="empty-state">멤버가 없습니다. ‘+ 멤버 추가’로 시작하세요.</div>}
        {sorted.map((m) => (
          <Column key={m.id} m={m} removing={removing} canEdit={canManageMembers} onEditMember={(p) => editMember(m, p)} onRemoveMember={() => removeMember(m)}
            open={tasks.filter((t) => t.member_id === m.id && !t.done)
              .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.created_at.localeCompare(b.created_at))}
            done={tasks.filter((t) => t.member_id === m.id && t.done).sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""))} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function Column({ m, removing, canEdit, onEditMember, onRemoveMember, open, done }: {
  m: Member; removing: boolean; open: Task[]; done: Task[];
  canEdit: boolean; onEditMember: (p: { name: string; job_title: string | null; duty: string | null }) => Promise<boolean>; onRemoveMember: () => void;
}) {
  const { today, clients, onAdd, onPatch } = useBoard();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(today);
  const [client, setClient] = useState("");
  const [repeat, setRepeat] = useState<Task["repeat"]>("none");
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [over, setOver] = useState(false);
  const todays = open.filter((t) => !t.due_on || t.due_on <= today);
  const later = open.filter((t) => t.due_on && t.due_on > today);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = title.trim();
    if (!v || busy) return;
    setBusy(true);
    if (await onAdd(m.id, { title: v, due_on: due || null, client_id: client || null, repeat })) { setTitle(""); setDue(today); setClient(""); setRepeat("none"); }
    setBusy(false);
  }

  return (
    <section className={`col ${over ? "drop" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("text/task")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const id = e.dataTransfer.getData("text/task"); if (id) { e.preventDefault(); onPatch(id, { member_id: m.id }); } }}>
      <div className="col-card">
        {editing ? (
          <form className="col-edit" onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const name = String(fd.get("name") ?? "").trim();
            if (!name) return;
            if (await onEditMember({ name, job_title: String(fd.get("title") ?? "") || null, duty: String(fd.get("duty") ?? "").trim() || null })) setEditing(false);
          }}>
            <input name="name" defaultValue={m.name} maxLength={40} required className="search" aria-label="이름" />
            <select name="title" defaultValue={m.job_title ?? ""} aria-label="직급"><option value="">직급 없음</option>{JOB_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <input name="duty" defaultValue={m.duty ?? ""} maxLength={100} className="search" placeholder="담당 업무" aria-label="담당 업무" />
            <span className="row"><button className="btn sm primary">저장</button><button type="button" className="btn sm" onClick={() => setEditing(false)}>취소</button></span>
          </form>
        ) : (
          <>
            <div className="col-h">
              <h3>{m.name}{m.job_title && <span className="col-title">{m.job_title}</span>}</h3>
              <span className="faint">{todays.length}건</span>
              {canEdit && !removing && <button className="icon-btn" onClick={() => setEditing(true)} aria-label={`${m.name} 정보 수정`} title="이름 · 직급 · 담당 업무 수정">✎</button>}
              {removing && <button className="col-x" onClick={onRemoveMember} aria-label={`${m.name} 멤버 삭제`}>×</button>}
            </div>
            {m.duty && <div className="col-duty">{m.duty}</div>}
          </>
        )}
        <form className="add-task" onSubmit={submit}>
          <span className="plus" aria-hidden="true">+</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="업무 추가" aria-label={`${m.name} 업무 추가`} />
          {title && (
            <div className="add-opts">
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="add-due" aria-label="업무일" />
              <select value={client} onChange={(e) => setClient(e.target.value)} className="add-due" aria-label="광고주"><option value="">광고주 없음</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <select value={repeat} onChange={(e) => setRepeat(e.target.value as Task["repeat"])} className="add-due" aria-label="반복">{Object.entries(REPEAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button className="btn sm primary" disabled={busy}>추가</button>
            </div>
          )}
        </form>
        <ul className="tasks">
          {todays.length === 0 && later.length === 0 && <li className="faint empty-t">오늘 할 일이 없습니다</li>}
          {todays.map((t) => <TaskRow key={t.id} t={t} />)}
          {later.length > 0 && <li className="later-h faint">예정</li>}
          {later.map((t) => <TaskRow key={t.id} t={t} />)}
        </ul>
      </div>

      <div className="col-card done-card">
        <button className="done-h" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
          <span>완료 ({done.length})</span><span className="chev" aria-hidden="true">{showDone ? "▴" : "▾"}</span>
        </button>
        {showDone && (
          <ul className="tasks">
            {done.length === 0 && <li className="faint empty-t">최근 7일 완료한 업무가 없습니다</li>}
            {done.map((t) => <TaskRow key={t.id} t={t} />)}
          </ul>
        )}
      </div>
    </section>
  );
}

function TaskRow({ t }: { t: Task }) {
  const { today, members, clients, onToggle, onPatch, onRemove } = useBoard();
  const [editing, setEditing] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const overdue = !t.done && t.due_on && t.due_on < today;
  const client = clients.find((c) => c.id === t.client_id);

  if (editing) return (
    <li className="task editing">
      <form className="task-edit" onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const title = String(fd.get("title") ?? "").trim();
        if (!title) return;
        onPatch(t.id, {
          title, due_on: String(fd.get("due") ?? "") || null, member_id: String(fd.get("member")),
          client_id: String(fd.get("client") ?? "") || null, repeat: String(fd.get("repeat")) as Task["repeat"], note: String(fd.get("note") ?? "").trim() || null,
        });
        setEditing(false);
      }} onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}>
        <input name="title" autoFocus defaultValue={t.title} maxLength={300} aria-label="업무" />
        <div className="task-edit-grid">
          <label>업무일<input name="due" type="date" defaultValue={t.due_on ?? ""} className="add-due" /></label>
          <label>담당<select name="member" defaultValue={t.member_id} className="add-due">{members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.job_title ? ` ${m.job_title}` : ""}</option>)}</select></label>
          <label>광고주<select name="client" defaultValue={t.client_id ?? ""} className="add-due"><option value="">없음</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>반복<select name="repeat" defaultValue={t.repeat} className="add-due">{Object.entries(REPEAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <textarea name="note" defaultValue={t.note ?? ""} maxLength={1000} rows={2} placeholder="메모 (선택)" aria-label="메모" />
        <div className="row"><button className="btn sm primary">저장</button><button type="button" className="btn sm" onClick={() => setEditing(false)}>취소</button></div>
      </form>
    </li>
  );
  return (
    <li className={`task ${t.done ? "done" : ""}`} draggable={!t.done}
      onDragStart={(e) => { e.dataTransfer.setData("text/task", t.id); e.dataTransfer.effectAllowed = "move"; }}>
      <button className="check" onClick={() => onToggle(t)} aria-label={t.done ? "완료 취소" : "완료"} title={t.done ? "완료 취소" : "완료"}>{t.done ? "✓" : ""}</button>
      <div className="task-t" onDoubleClick={() => !t.done && setEditing(true)}>
        <span>{t.title}</span>
        {(client || t.auto || t.repeat !== "none" || (t.due_on && t.due_on !== today && !t.done) || t.note) && (
          <span className="task-meta">
            {t.due_on && t.due_on !== today && !t.done && <span className={`due ${overdue ? "over" : ""}`}>{overdue ? `${md(t.due_on)} 지남` : md(t.due_on)}</span>}
            {client && <span className="tag">{client.name}</span>}
            {t.auto && <span className="tag auto" title="계약 마감 3일 전 자동 등록">자동</span>}
            {t.repeat !== "none" && <span className="tag" title="반복 업무">↻ {REPEAT[t.repeat]}</span>}
            {t.note && <button className="tag note-btn" onClick={() => setShowNote(!showNote)} aria-expanded={showNote}>메모</button>}
          </span>
        )}
        {showNote && t.note && <span className="task-note">{t.note}</span>}
      </div>
      <span className="task-act">
        {!t.done && <button onClick={() => setEditing(true)} aria-label="수정" title="수정">✎</button>}
        <button onClick={() => onRemove(t)} aria-label="삭제" title="삭제">🗑</button>
      </span>
    </li>
  );
}
