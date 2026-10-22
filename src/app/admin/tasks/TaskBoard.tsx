"use client";
// 업무 확인 보드: 멤버별 열(가로) · 업무 목록(세로)
// - 열 위쪽 입력창: 업무 추가(Enter), 업무일 선택 가능(기본 오늘)
// - 업무에 마우스를 올리면 수정(✎) · 삭제(🗑). 동그라미를 누르면 완료 → 아래 "완료됨" 상자로 이동
// - 상단: 멤버 추가 · 멤버 삭제(오너·관리자)
// 저장은 로그인 세션으로 직접 하며, DB 규칙이 직원 여부·관리자 여부를 다시 확인한다.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { JOB_TITLES, jobRank, NEW_JOB_TITLES } from "@/lib/titles";

export type Member = { id: string; name: string; user_id: string | null; sort: number; job_title: string | null; duty: string | null };
export type Task = { id: string; member_id: string; title: string; due_on: string | null; done: boolean; done_at: string | null; sort: number; created_at: string };

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const dayLabel = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

export default function TaskBoard({ today, meId, canManageMembers, members: initMembers, tasks: initTasks, directory }: {
  today: string; meId: string; canManageMembers: boolean; members: Member[]; tasks: Task[]; directory: { id: string; name: string; email: string }[];
}) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [members, setMembers] = useState(initMembers);
  const [tasks, setTasks] = useState(initTasks);
  // 새로고침으로 서버 자료가 바뀌면 화면 목록도 새 자료로 바꾼다
  const [src, setSrc] = useState({ initMembers, initTasks });
  if (src.initMembers !== initMembers || src.initTasks !== initTasks) {
    setSrc({ initMembers, initTasks }); setMembers(initMembers); setTasks(initTasks);
  }
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);       // 멤버 추가 입력 열림
  const [removing, setRemoving] = useState(false);   // 멤버 삭제 모드
  const fail = (t: string) => setMsg(t);

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
    setMembers([...members, data as Member]); setAdding(false); setMsg(null);
  }
  // 멤버 이름 · 직급 · 담당 업무 수정 (오너·관리자). 직원 계정과 연결된 멤버는 직원 정보도 함께 바뀐다
  async function editMember(m: Member, p: { name: string; job_title: string | null; duty: string | null }) {
    const { error } = m.user_id
      ? await sb.rpc("set_staff_profile", { p_user: m.user_id, p_name: p.name, p_title: p.job_title ?? "", p_duty: p.duty ?? "" })
      : await sb.from("task_members").update(p).eq("id", m.id);
    if (error) { fail("멤버 정보를 저장하지 못했습니다."); return false; }
    setMembers(members.map((x) => (x.id === m.id ? { ...x, ...p } : x))); setMsg(null);
    return true;
  }
  async function removeMember(m: Member) {
    const n = tasks.filter((t) => t.member_id === m.id && !t.done).length;
    if (!confirm(`${m.name} 멤버를 삭제할까요?${n ? `\n남은 업무 ${n}건과 완료 기록도 함께 삭제됩니다.` : ""}`)) return;
    const { error } = await sb.from("task_members").delete().eq("id", m.id);
    if (error) return fail("멤버를 삭제하지 못했습니다.");
    setMembers(members.filter((x) => x.id !== m.id)); setTasks(tasks.filter((t) => t.member_id !== m.id));
  }

  // ── 업무 ─────────────────────────────────────────────
  async function addTask(memberId: string, title: string, due: string) {
    const { data, error } = await sb.from("team_tasks")
      .insert({ member_id: memberId, title, due_on: due || null, created_by: meId })
      .select("id, member_id, title, due_on, done, done_at, sort, created_at").single();
    if (error || !data) { fail("업무를 추가하지 못했습니다."); return false; }
    setTasks([...tasks, data as Task]); setMsg(null);
    return true;
  }
  async function patch(id: string, p: Partial<Task>) {
    const before = tasks;
    setTasks(tasks.map((t) => (t.id === id ? { ...t, ...p } : t)));   // 화면 먼저 반영
    const { error } = await sb.from("team_tasks").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { setTasks(before); fail("저장하지 못했습니다."); }
  }
  const toggle = (t: Task) => patch(t.id, { done: !t.done, done_at: t.done ? null : new Date().toISOString() });
  async function remove(t: Task) {
    if (!confirm(`“${t.title}” 업무를 삭제할까요?`)) return;
    const before = tasks;
    setTasks(tasks.filter((x) => x.id !== t.id));
    const { error } = await sb.from("team_tasks").delete().eq("id", t.id);
    if (error) { setTasks(before); fail("삭제하지 못했습니다."); }
  }

  const openAll = tasks.filter((t) => !t.done);
  const todayCount = openAll.filter((t) => !t.due_on || t.due_on <= today).length;
  const doneToday = tasks.filter((t) => t.done && t.done_at && new Date(Date.parse(t.done_at) + 9 * 3600_000).toISOString().slice(0, 10) === today).length;
  const unlinked = directory.filter((d) => !members.some((m) => m.user_id === d.id));

  return (
    <>
      <header className="tasks-head">
        <div>
          <div className="faint">믿는구석 · 전체 구성원</div>
          <h1>업무 확인 <span className="h-sub">{dayLabel(today)}</span></h1>
          <div className="faint mt-xs">오늘 할 일 {todayCount}건 · 오늘 완료 {doneToday}건</div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => router.refresh()} title="다른 직원이 바꾼 내용 불러오기">↻ 새로고침</button>
          {canManageMembers && <>
            <button className={`btn sm ${adding ? "primary" : ""}`} onClick={() => { setAdding(!adding); setRemoving(false); }}>+ 멤버 추가</button>
            <button className={`btn sm ${removing ? "danger" : ""}`} onClick={() => { setRemoving(!removing); setAdding(false); }}>{removing ? "삭제 끝내기" : "− 멤버 삭제"}</button>
          </>}
        </div>
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
      {msg && <div className="notice">{msg}</div>}

      <div className="board">
        {members.length === 0 && <div className="empty-state">멤버가 없습니다. ‘+ 멤버 추가’로 시작하세요.</div>}
        {[...members].sort((a, b) => jobRank(a.job_title) - jobRank(b.job_title) || a.sort - b.sort).map((m) => (
          <Column key={m.id} m={m} today={today} removing={removing} canEdit={canManageMembers} onEditMember={(p) => editMember(m, p)}
            open={tasks.filter((t) => t.member_id === m.id && !t.done)
              .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.created_at.localeCompare(b.created_at))}
            done={tasks.filter((t) => t.member_id === m.id && t.done).sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""))}
            onAdd={addTask} onToggle={toggle} onPatch={patch} onRemove={remove} onRemoveMember={() => removeMember(m)} />
        ))}
      </div>
    </>
  );
}

function Column({ m, today, removing, canEdit, onEditMember, open, done, onAdd, onToggle, onPatch, onRemove, onRemoveMember }: {
  m: Member; today: string; removing: boolean; open: Task[]; done: Task[];
  canEdit: boolean; onEditMember: (p: { name: string; job_title: string | null; duty: string | null }) => Promise<boolean>;
  onAdd: (memberId: string, title: string, due: string) => Promise<boolean>;
  onToggle: (t: Task) => void; onPatch: (id: string, p: Partial<Task>) => void; onRemove: (t: Task) => void; onRemoveMember: () => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(today);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const todays = open.filter((t) => !t.due_on || t.due_on <= today);
  const later = open.filter((t) => t.due_on && t.due_on > today);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = title.trim();
    if (!v || busy) return;
    setBusy(true);
    if (await onAdd(m.id, v, due)) { setTitle(""); setDue(today); }
    setBusy(false);
  }

  return (
    <section className="col">
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
          {title && <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="add-due" aria-label="업무일" />}
        </form>
        <ul className="tasks">
          {todays.length === 0 && later.length === 0 && <li className="faint empty-t">오늘 할 일이 없습니다</li>}
          {todays.map((t) => <TaskRow key={t.id} t={t} today={today} onToggle={onToggle} onPatch={onPatch} onRemove={onRemove} />)}
          {later.length > 0 && <li className="later-h faint">예정</li>}
          {later.map((t) => <TaskRow key={t.id} t={t} today={today} onToggle={onToggle} onPatch={onPatch} onRemove={onRemove} />)}
        </ul>
      </div>

      <div className="col-card done-card">
        <button className="done-h" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
          <span>완료 ({done.length})</span><span className="chev" aria-hidden="true">{showDone ? "▴" : "▾"}</span>
        </button>
        {showDone && (
          <ul className="tasks">
            {done.length === 0 && <li className="faint empty-t">최근 7일 완료한 업무가 없습니다</li>}
            {done.map((t) => <TaskRow key={t.id} t={t} today={today} onToggle={onToggle} onPatch={onPatch} onRemove={onRemove} />)}
          </ul>
        )}
      </div>
    </section>
  );
}

function TaskRow({ t, today, onToggle, onPatch, onRemove }: {
  t: Task; today: string; onToggle: (t: Task) => void; onPatch: (id: string, p: Partial<Task>) => void; onRemove: (t: Task) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [due, setDue] = useState(t.due_on ?? "");
  const save = () => {
    const v = title.trim();
    if (v && (v !== t.title || (due || null) !== t.due_on)) onPatch(t.id, { title: v, due_on: due || null });
    else setTitle(t.title);
    setEditing(false);
  };
  const overdue = !t.done && t.due_on && t.due_on < today;

  if (editing) return (
    <li className="task editing">
      <input autoFocus value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setTitle(t.title); setDue(t.due_on ?? ""); setEditing(false); } }} />
      <div className="row">
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="add-due" aria-label="업무일" />
        <button className="btn sm primary" onClick={save}>저장</button>
        <button className="btn sm" onClick={() => { setTitle(t.title); setDue(t.due_on ?? ""); setEditing(false); }}>취소</button>
      </div>
    </li>
  );
  return (
    <li className={`task ${t.done ? "done" : ""}`}>
      <button className="check" onClick={() => onToggle(t)} aria-label={t.done ? "완료 취소" : "완료"} title={t.done ? "완료 취소" : "완료"}>{t.done ? "✓" : ""}</button>
      <div className="task-t" onDoubleClick={() => !t.done && setEditing(true)}>
        <span>{t.title}</span>
        {t.due_on && t.due_on !== today && !t.done && <span className={`due ${overdue ? "over" : ""}`}>{overdue ? `${md(t.due_on)} 지남` : md(t.due_on)}</span>}
      </div>
      <span className="task-act">
        {!t.done && <button onClick={() => setEditing(true)} aria-label="수정" title="수정">✎</button>}
        <button onClick={() => onRemove(t)} aria-label="삭제" title="삭제">🗑</button>
      </span>
    </li>
  );
}
