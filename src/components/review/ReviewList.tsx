"use client";
// 파일 검수 목록: 원고 1개 = 1줄 (제목 · 블로그/홈페이지 구분 · 상태), 목록에서 바로 '검수 완료' / '재검수 요청'
// 제목을 누르면 원문이 바로 열리고, 아래 코멘트 칸에 수정할 내용을 적어 '재검수 요청'을 보낸다
// - 광고주 계정: 검수 대기 원고만 결정 (review_decide — 로그인 · 버전 · 중복 확인)
// - 담당 직원: 이미 확정 · 전화로 받은 요청을 대신 표시 (review_staff_complete / review_staff_changes, 기록에 담당자로 남음)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { confirmDialog, toast, toastError } from "@/components/ui";
import type { ReviewEvent, ReviewFile, ReviewItem } from "@/lib/review";
import { editableOf, isDocx, isImage, isPdf, isSheet, type ThumbFile } from "./ReviewFiles";
import { removeReviewItem, ReviewEditDialog } from "./ReviewStaff";
import DocxEditable from "./DocxEditor";
import SheetEditable from "./SheetEditor";
import ReviewReplies from "./ReviewReply";

type Row = ReviewItem & { files: ReviewFile[]; events: ReviewEvent[] };
const KIND: Record<string, string> = { keyword: "주제 · 키워드", blog: "블로그", column: "홈페이지 칼럼", cardnews: "SNS 카드뉴스", etc: "기타" };
const STATUS: Record<string, [string, string]> = { draft: ["작성 중", ""], pending: ["검수 대기", "warn"], approved: ["검수 완료", "good"], changes: ["재검수 요청", "bad"] };
const kst = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "-");
const thumb = (f: ReviewFile): ThumbFile => ({ id: f.id, name: f.file_name, url: f.url ?? null, mime: f.mime_type, size: f.size_bytes });
const dl = (f: ReviewFile) => (f.url ? `${f.url}${f.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(f.file_name)}` : undefined);
const Status = ({ s }: { s: string }) => <span className={`badge ${STATUS[s]?.[1] ?? ""}`}>{STATUS[s]?.[0] ?? s}</span>;

// 누가 무엇을 할 수 있나
const canApprove = (r: Row, staff: boolean) => (staff ? r.status !== "approved" && r.files.length > 0 : r.status === "pending");
const canChanges = (r: Row, staff: boolean) => (staff ? ["draft", "pending", "approved"].includes(r.status) : r.status === "pending");
// 카드뉴스 이미지별 코멘트: 광고주는 검수 대기 · 재검수 요청 중(같은 버전)에 계속 남길 수 있다
const canFileComment = (r: Row, staff: boolean) => (staff ? r.files.length > 0 : r.status === "pending" || r.status === "changes");
// 화면에서 원고 수정 (블로그 · 칼럼 Word): 직원은 검수 완료 뒤에도, 광고주는 검수 대기 중만 — 저장할 때 서버가 다시 확인
const canEdit = (r: Row, staff: boolean) => ["blog", "column", "keyword"].includes(r.kind) && (staff || r.status === "pending");   // 직원: 검수 완료 뒤에도, 광고주: 검수 대기 중만
const isBoard = (r: Row) => r.kind === "cardnews" && r.files.length > 0 && r.files.every((f) => isImage(thumb(f)));
const who = (e: ReviewEvent) => e.actor_name ?? (e.actor_kind === "client" ? "광고주" : "담당자");

export default function ReviewList({ rows, staff, base }: { rows: Row[]; staff: boolean; base: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ id: string; write: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Row | null>(null);
  const cur = open ? rows.find((r) => r.id === open.id) ?? null : null;

  async function approve(r: Row) {
    if (busy) return;
    if (!(await confirmDialog({ title: "검수 완료로 처리할까요?", body: `“${r.title}” (${r.version}차 원고)${staff ? "\n담당자 완료 처리로 기록됩니다." : "\n검수 완료 후에는 이 버전을 기준으로 진행합니다."}`, ok: "검수 완료" }))) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = staff ? await sb.rpc("review_staff_complete", { p_item: r.id }) : await sb.rpc("review_decide", { p_item: r.id, p_version: r.version, p_approve: true });
    setBusy(false);
    if (error) return toastError(/stale/.test(error.message) ? "그 사이 수정본이 올라왔습니다. 새로 고쳐서 다시 확인해 주세요." : /no files/.test(error.message) ? "파일을 먼저 올려 주세요." : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    toast("검수 완료로 처리했습니다."); setOpen(null); router.refresh();
  }
  async function changes(r: Row, comment: string) {
    if (busy) return false;
    if (!comment.trim()) { toastError("수정할 내용을 코멘트 칸에 적어 주세요."); return false; }
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = staff ? await sb.rpc("review_staff_changes", { p_item: r.id, p_comment: comment.trim() }) : await sb.rpc("review_decide", { p_item: r.id, p_version: r.version, p_approve: false, p_comment: comment.trim() });
    setBusy(false);
    if (error) { toastError(/stale/.test(error.message) ? "그 사이 수정본이 올라왔습니다. 새로 고쳐서 다시 확인해 주세요." : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요."); return false; }
    toast(staff ? "재검수 요청으로 표시했습니다." : "재검수 요청을 보냈습니다. 담당자가 수정본을 올리면 다시 확인하실 수 있습니다."); setOpen(null); router.refresh();
    return true;
  }
  async function setKind(r: Row, kind: string) {
    const { error } = await supabaseBrowser().from("review_items").update({ kind, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) return toastError("구분을 바꾸지 못했습니다.");
    toast(`‘${KIND[kind]}’로 바꿨습니다.`); router.refresh();
  }

  return (
    <>
      <div className="card tbl-wrap mt"><table className="rtable review-table">
        <thead><tr><th>원고 제목</th><th>구분</th><th>검수 상태</th><th>요청일</th><th className="r">검수</th></tr></thead>
        <tbody>{rows.map((r) => {
          // 주제 · 키워드: 엑셀 · CSV 내용을 목록 안에서 바로 표로 펼친다
          const sheets = r.kind === "keyword" ? r.files.filter((f) => f.url && isSheet(thumb(f))) : [];
          return (<Fragment key={r.id}>
          <tr className={sheets.length ? "has-inline" : ""}>
            <td>
              <button type="button" className="linkish cname" onClick={() => setOpen({ id: r.id, write: false })} title="원문 보기">{r.title}</button>
              {r.version > 1 && <span className="faint"> · {r.version}차</span>}
            </td>
            <td data-label="구분">
              {staff
                ? <select className={`kind-sel k-${r.kind}`} value={r.kind} onChange={(e) => setKind(r, e.target.value)} aria-label="구분">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                : <span className={`kind-tag k-${r.kind}`}>{KIND[r.kind] ?? r.kind}</span>}
            </td>
            <td data-label="검수 상태"><Status s={r.status} /></td>
            <td data-label="요청일" className="num faint">{r.requested_at ? kst(r.requested_at).slice(5) : "-"}</td>
            <td className="r">
              <div className="row review-row-act">
                {canApprove(r, staff) && <button className="btn sm decide-ok" disabled={busy} onClick={() => approve(r)}>✓ 검수 완료</button>}
                {canChanges(r, staff) && <button className="btn sm" disabled={busy} onClick={() => setOpen({ id: r.id, write: true })}>재검수 요청</button>}
                {!canApprove(r, staff) && !canChanges(r, staff) && <button className="btn sm" onClick={() => setOpen({ id: r.id, write: false })}>원문 보기</button>}
                <Link className="btn sm ghost" href={`${base}/review/${r.id}`} title="버전 · 기록 · 파일 관리 · 수정">상세</Link>
                {staff && <button className="btn sm ghost" disabled={busy} onClick={() => setEdit(r)}>수정</button>}
                {staff && <button className="btn sm ghost" disabled={busy} onClick={async () => { if (await removeReviewItem(r.id, r.title, r.status)) router.refresh(); }}>삭제</button>}
              </div>
            </td>
          </tr>
          {sheets.length > 0 && (
            <tr className="rv-inline"><td colSpan={5}>
              {sheets.map((f) => <div key={f.id} className="rv-inline-sheet">{sheets.length > 1 && <div className="faint">{f.file_name}</div>}<SheetEditable key={f.id} f={editableOf(f)} canEdit={canEdit(r, staff)} /></div>)}
            </td></tr>
          )}
          </Fragment>);
        })}</tbody>
      </table></div>
      {edit && <ReviewEditDialog item={edit} onClose={() => setEdit(null)} />}
      {cur && <Viewer key={cur.id} r={cur} staff={staff} write={open!.write} busy={busy} onClose={() => setOpen(null)} onApprove={() => approve(cur)} onChanges={(c) => changes(cur, c)}
        nav={{ prev: rows[rows.indexOf(cur) - 1]?.id, next: rows[rows.indexOf(cur) + 1]?.id, go: (id) => setOpen({ id, write: false }), pos: `${rows.indexOf(cur) + 1} / ${rows.length}` }} />}
    </>
  );
}

// 원문 보기 창: 원고 전체 + 코멘트 칸 + 검수 완료 / 재검수 요청
function Viewer({ r, staff, write, busy, onClose, onApprove, onChanges, nav }: {
  r: Row; staff: boolean; write: boolean; busy: boolean; onClose: () => void; onApprove: () => void; onChanges: (c: string) => Promise<boolean>;
  nav: { prev?: string; next?: string; go: (id: string) => void; pos: string };
}) {
  const [comment, setComment] = useState("");
  const [sel, setSel] = useState<number | null>(null);   // 카드뉴스: 원본으로 보고 있는 이미지 번호
  const box = useRef<HTMLTextAreaElement>(null);
  const board = isBoard(r);
  useEffect(() => { if (write) box.current?.focus(); }, [write]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) { if (e.key === "Escape") e.target.blur(); return; }   // 코멘트 · 원고 수정 입력 중
      if (e.key === "Escape") { if (sel != null) setSel(null); else onClose(); }
      if (sel != null && e.key === "ArrowRight") setSel(Math.min(r.files.length - 1, sel + 1));
      if (sel != null && e.key === "ArrowLeft") setSel(Math.max(0, sel - 1));
    };
    window.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = ""; };
  }, [onClose, sel, r.files.length]);
  const notes = r.events.filter((e) => e.comment && !e.file_id && e.action !== "reply" && e.action !== "edit");
  const ok = canApprove(r, staff), ch = canChanges(r, staff);
  return (
    <div className="modal file-viewer review-viewer" role="dialog" aria-modal="true" aria-label={r.title}>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-panel">
        <button type="button" className="modal-x" onClick={onClose} aria-label="닫기">×</button>
        <div className="fv-head">
          <span className={`kind-tag k-${r.kind}`}>{KIND[r.kind] ?? r.kind}</span>
          <b className="fv-name">{r.title}</b>
          <Status s={r.status} />
          <span className="faint">{r.version}차 원고</span>
          <span className="fv-nav">
            <span className="faint">{nav.pos}</span>
            <button type="button" className="btn sm" disabled={!nav.prev} onClick={() => nav.prev && nav.go(nav.prev)}>‹ 이전 원고</button>
            <button type="button" className="btn sm" disabled={!nav.next} onClick={() => nav.next && nav.go(nav.next)}>다음 원고 ›</button>
          </span>
        </div>
        {board ? <CardBoard r={r} staff={staff} sel={sel} setSel={setSel} /> : <div className="fv-body rv-body">
          {r.files.length === 0 && <p className="faint pad">올린 파일이 없습니다.</p>}
          {r.files.map((f) => {
            const t = thumb(f);
            return (
              <section key={f.id} className="rv-file">
                {r.files.length > 1 && <div className="rv-file-h"><span>{f.file_name}</span>{dl(f) && <a href={dl(f)}>내려받기</a>}</div>}
                {!f.url ? <p className="faint pad">파일 주소를 만들지 못했습니다.</p>
                  : isDocx(t) ? <DocxEditable key={f.id} f={editableOf(f)} canEdit={canEdit(r, staff)} />
                  // eslint-disable-next-line @next/next/no-img-element
                  : isImage(t) ? <img src={f.url} alt={f.file_name} />
                  : isSheet(t) ? <SheetEditable key={f.id} f={editableOf(f)} canEdit={canEdit(r, staff)} />
                  : isPdf(t) ? <iframe src={f.url} title={f.file_name} />
                  : <div className="notice">이 형식은 화면에서 바로 볼 수 없습니다. <a href={dl(f)}>내려받기</a></div>}
              </section>
            );
          })}
        </div>}
        {sel == null && <div className="rv-foot">
          {notes.length > 0 && (
            <ul className="rv-notes">
              {notes.slice(0, 4).map((e) => <li key={e.id}><b>{e.action === "changes" ? "재검수 요청" : e.action === "approve" ? "검수 완료" : "메모"}</b><span className="faint">{e.version}차 · {e.actor_name ?? (e.actor_kind === "client" ? "광고주" : "담당자")} · {kst(e.created_at)}</span><span className="rv-note">{e.comment}</span><ReviewReplies parent={e} events={r.events} staff={staff} /></li>)}
            </ul>
          )}
          {ch && <textarea ref={box} value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} placeholder={staff ? "재검수 요청 내용 (광고주에게 받은 수정 사항을 적어 주세요)" : "수정할 내용을 적어 주세요. 예: 두 번째 문단의 표현을 바꿔 주세요."} aria-label="코멘트" />}
          <div className="row rv-act">
            {ok && <button className="btn decide-ok" disabled={busy} onClick={onApprove}>✓ 검수 완료</button>}
            {ch && <button className="btn primary" disabled={busy} onClick={() => onChanges(comment)}>{busy ? "보내는 중…" : "재검수 요청"}</button>}
            {!ok && !ch && <span className="faint">{r.status === "approved" ? "검수 완료된 원고입니다." : r.status === "changes" ? "재검수 요청 중입니다. 담당자가 수정본을 올리면 다시 검수할 수 있습니다." : "검수 대기 중인 원고가 아닙니다."}</span>}
          </div>
        </div>}
      </div>
    </div>
  );
}

// 이미지 아래 · 원본 옆에 붙는 수정 요청 코멘트
function FileNotes({ list, all, staff }: { list: ReviewEvent[]; all: ReviewEvent[]; staff: boolean }) {
  if (list.length === 0) return null;
  return <ul className="cn-notes">{list.map((e) => <li key={e.id}><span className="faint">{e.version}차 · {who(e)} · {kst(e.created_at).slice(5)}</span><span>{e.comment}</span><ReviewReplies parent={e} events={all} staff={staff} /></li>)}</ul>;
}

// 카드뉴스: 이미지를 아트보드처럼 썸네일로 → 누르면 한 화면 안에 원본 + 그 이미지에 대한 수정 요청 코멘트
function CardBoard({ r, staff, sel, setSel }: { r: Row; staff: boolean; sel: number | null; setSel: (i: number | null) => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const touchX = useRef<number | null>(null);   // 휴대폰: 원본을 좌우로 밀어서 넘기기
  const notesOf = (id: string) => r.events.filter((e) => e.file_id === id && e.comment && e.action !== "reply" && e.action !== "edit");
  const can = canFileComment(r, staff);
  async function send(f: ReviewFile) {
    if (!text.trim()) return toastError("수정할 내용을 적어 주세요.");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("review_file_comment", { p_item: r.id, p_file: f.id, p_version: r.version, p_comment: text.trim() });
    setBusy(false);
    if (error) return toastError(/stale/.test(error.message) ? "그 사이 수정본이 올라왔습니다. 새로 고쳐서 다시 확인해 주세요." : "코멘트를 남기지 못했습니다.");
    setText(""); toast("이 이미지에 수정 요청을 남겼습니다."); router.refresh();
  }
  if (sel != null && r.files[sel]) {
    const f = r.files[sel];
    const go = (i: number) => { if (i >= 0 && i < r.files.length) { setSel(i); setText(""); } };
    return (
      <div className="cn-orig">
        <div className="cn-orig-bar">
          <button type="button" className="btn sm" onClick={() => setSel(null)}>‹ 썸네일로</button>
          <span className="faint">{sel + 1} / {r.files.length} · {f.file_name}</span>
          <span className="cn-orig-nav">
            <button type="button" className="btn sm" disabled={sel === 0} onClick={() => go(sel - 1)}>‹ 이전</button>
            <button type="button" className="btn sm" disabled={sel === r.files.length - 1} onClick={() => go(sel + 1)}>다음 ›</button>
            {dl(f) && <a className="btn sm ghost" href={dl(f)}>내려받기</a>}
          </span>
        </div>
        <div className="cn-orig-main">
          <div className="cn-orig-img"
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => { if (touchX.current == null) return; const dx = e.changedTouches[0].clientX - touchX.current; touchX.current = null; if (Math.abs(dx) > 50) go(dx < 0 ? sel + 1 : sel - 1); }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {f.url ? <img src={f.url} alt={f.file_name} /> : <p className="faint">이미지를 불러오지 못했습니다.</p>}
            {sel > 0 && <button type="button" className="cn-arrow prev" onClick={() => go(sel - 1)} aria-label="이전 이미지">‹</button>}
            {sel < r.files.length - 1 && <button type="button" className="cn-arrow next" onClick={() => go(sel + 1)} aria-label="다음 이미지">›</button>}
            <span className="cn-count">{sel + 1} / {r.files.length}</span>
          </div>
          <aside className="cn-orig-side">
            <b>이 이미지 수정 요청</b>
            <FileNotes list={notesOf(f.id)} all={r.events} staff={staff} />
            {notesOf(f.id).length === 0 && <p className="faint">아직 코멘트가 없습니다.</p>}
            {can ? (
              <>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} placeholder="이 이미지에서 수정할 내용을 적어 주세요. 예: 두 번째 줄 문구를 ‘~’로 바꿔 주세요." aria-label="이미지 코멘트" />
                <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={() => send(f)}>{busy ? "남기는 중…" : "수정 요청 남기기"}</button>
              </>
            ) : <p className="faint">{r.status === "approved" ? "검수 완료된 카드뉴스입니다." : "지금은 코멘트를 남길 수 없습니다."}</p>}
          </aside>
        </div>
      </div>
    );
  }
  return (
    <div className="fv-body cn-body">
      <ul className="cn-board">
        {r.files.map((f, i) => (
          <li key={f.id} className={notesOf(f.id).length ? "has-notes" : ""}>
            <button type="button" className="cn-art" onClick={() => { setSel(i); setText(""); }} title="원본 보기">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {f.url ? <img src={f.url} alt={f.file_name} /> : <span className="faint">불러오기 실패</span>}
              <span className="cn-no">{i + 1}</span>
              {notesOf(f.id).length > 0 && <span className="cn-flag">수정 요청 {notesOf(f.id).length}</span>}
            </button>
            <FileNotes list={notesOf(f.id)} all={r.events} staff={staff} />
          </li>
        ))}
      </ul>
    </div>
  );
}
