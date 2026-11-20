"use client";
// 직원: 파일 검수 관리 — 콘텐츠 등록(유형 · 월 · Word · 엑셀 · 이미지) → 검수 요청 → 수정 요청 확인 → 수정본 등록(새 버전) → 재검수 요청
// 검수 완료는 광고주가 처리한다. 이미 확정된 콘텐츠만 담당 직원이 '완료 처리'(기록에 남음). 저장소 · 표 규칙이 담당 여부와 버전을 다시 확인한다
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ask, toast, toastError } from "@/components/ui";
import { FileThumbs } from "./ReviewFiles";

const KINDS = [["keyword", "주제 · 키워드"], ["blog", "블로그"], ["column", "홈페이지 칼럼"], ["cardnews", "SNS 카드뉴스"], ["etc", "기타"]] as const;
const ACCEPT = ".docx,.doc,.pdf,.hwp,.txt,.xlsx,.xls,.csv,image/png,image/jpeg,image/webp,image/gif";
const DOC = /\.(docx?|hwp|pdf|txt|xlsx?|csv)$/i;
// 엑셀은 브라우저가 형식을 비우거나 다르게 보내기도 해서 확장자로 정한다 (저장소가 허용 형식을 확인)
const MIME: Record<string, string> = { ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel", ".csv": "text/csv" };
const kindOf = (name: string, fallback: string) => (/키워드|주제/.test(name) ? "keyword" : /칼럼|홈페이지/.test(name) ? "column" : /블로그/.test(name) ? "blog" : /카드\s*뉴스|인스타/.test(name) ? "cardnews" : fallback);
const safe = (name: string) => name.replace(/[^\w.\-가-힣 ()]/g, "_").slice(-100);

async function uploadFiles(clientId: string, itemId: string, version: number, files: File[]) {
  const sb = supabaseBrowser();
  let ok = 0;
  for (const [i, f] of files.entries()) {
    if (f.size > 30 * 1024 * 1024) continue;
    const ext = (f.name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "").toLowerCase();
    const path = `${clientId}/${itemId}/v${version}/${crypto.randomUUID()}${ext}`;
    const type = MIME[ext] ?? (f.type || undefined);
    const up = await sb.storage.from("reviews").upload(path, f, { contentType: type, upsert: false });
    if (up.error) continue;
    const { error } = await sb.from("review_files").insert({ item_id: itemId, client_id: clientId, version, file_name: safe(f.name), storage_path: path, mime_type: type ?? null, size_bytes: f.size, sort: i });
    if (error) { await sb.storage.from("reviews").remove([path]); continue; }
    ok++;
  }
  return ok;
}

// 목록 화면 위: 새 콘텐츠 등록
type Picked = { id: string; file: File; url: string };

export function ReviewCreate({ clientId, period }: { clientId: string; period: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("blog");
  const card = kind === "cardnews";
  // 고른 파일은 등록 전에 바로 썸네일로 보여 준다 (브라우저 안 주소, 빼거나 닫으면 해제)
  const [picked, setPicked] = useState<Picked[]>([]);
  const pick = (list: File[]) => setPicked((p) => [...p, ...list.filter((f) => f.size > 0).map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]);
  const unpick = (id: string) => { picked.filter((x) => x.id === id).forEach((x) => URL.revokeObjectURL(x.url)); setPicked((p) => p.filter((x) => x.id !== id)); };
  const clear = () => { picked.forEach((x) => URL.revokeObjectURL(x.url)); setPicked([]); };
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    const files = picked.map((x) => x.file);
    if (!files.length) return toastError(card ? "카드뉴스 이미지를 올려 주세요." : "원고나 이미지 파일을 하나 이상 올려 주세요.");
    const topic = String(fd.get("topic") ?? "").trim();
    if (card && !topic) return toastError("카드뉴스 주제를 입력해 주세요.");
    // 카드뉴스: 주제 1개 = 검수 1건, 고른 이미지 전부를 파일명 순서(1, 2, … 10)대로 한 건에 담는다
    // 그 밖: 원고 1개 = 검수 1건. 제목은 원고 파일명(확장자 뺌), 구분은 파일명으로 자동(블로그 · 칼럼/홈페이지 · 카드뉴스), 없으면 고른 유형
    // 이미지는 원고가 1개면 그 원고에 붙이고, 원고가 여러 개면 이미지끼리 1건으로 묶는다
    const docs = files.filter((f) => DOC.test(f.name));
    const images = files.filter((f) => !DOC.test(f.name));
    const byName = (a: File, b: File) => a.name.localeCompare(b.name, "ko", { numeric: true });
    const groups: File[][] = card ? [[...files].sort(byName)] : docs.length === 0 ? [images] : docs.length === 1 ? [[docs[0], ...images]] : [...docs.map((d) => [d]), ...(images.length ? [images] : [])];
    const fallback = String(fd.get("kind"));
    const after = String(fd.get("after"));
    setBusy(true);
    const sb = supabaseBrowser();
    let made = 0, uploaded = 0, failed = 0;
    for (const g of groups) {
      const title = card ? topic.slice(0, 200) : ((g.length > 1 && !DOC.test(g[0].name) ? `이미지 ${g.length}장 — ` : "") + g[0].name.replace(/\.[^.]+$/, "").trim() || "검수 콘텐츠").slice(0, 200);
      const { data, error } = await sb.from("review_items").insert({ client_id: clientId, kind: card ? "cardnews" : kindOf(g[0].name, fallback), period: String(fd.get("period")), title }).select("id").single();
      if (error || !data) { failed++; continue; }
      const ok = await uploadFiles(clientId, data.id, 1, g);
      made++; uploaded += ok;
      if (!ok) continue;
      const { error: e2 } = after === "request" ? await sb.rpc("review_request", { p_item: data.id })
        : after === "complete" ? await sb.rpc("review_staff_complete", { p_item: data.id, p_comment: "완료된 콘텐츠로 등록" }) : { error: null };
      if (e2) failed++;
    }
    setBusy(false); form.reset(); clear(); setKind("blog"); setOpen(false);
    const what = after === "request" ? "검수를 요청했습니다" : after === "complete" ? "검수 완료로 등록했습니다" : "작성 중으로 등록했습니다";
    if (failed) toastError(`원고 ${made}건 · 파일 ${uploaded}개를 올렸지만 ${failed}건은 처리하지 못했습니다. 목록에서 확인해 주세요.`);
    else toast(card ? `카드뉴스 ‘${topic}’(이미지 ${uploaded}장) ${what}.` : `원고 ${made}건(파일 ${uploaded}개) ${what}.`);
    router.refresh();
  }
  if (!open) return <button className="btn primary" onClick={() => setOpen(true)}>+ 검수 콘텐츠 등록</button>;
  const tooBig = picked.filter((x) => x.file.size > 30 * 1024 * 1024).length;
  return (
    <form className="card pad review-create" onSubmit={create}>
      <h3>검수 콘텐츠 등록</h3>
      <div className="st-form">
        <label>구분{card ? "" : " (파일명에 ‘키워드’ · ‘블로그’ · ‘칼럼’이 있으면 자동)"}<select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>대상 월<input name="period" type="month" defaultValue={period} required className="search" /></label>
        {card && <label className="w2">카드뉴스 주제<input name="topic" required maxLength={200} className="search" placeholder="예: 29회차 야맹증" autoFocus /></label>}
        <label className="w-all">{card ? "카드뉴스 이미지 (한 주제의 이미지를 모두 선택, 파일명 순서대로 정리)" : "원고 · 엑셀 · 이미지 (여러 개 선택, 파일당 30MB 이하)"}<input type="file" multiple accept={card ? "image/png,image/jpeg,image/webp,image/gif" : ACCEPT} className="search" onChange={(e) => { pick([...(e.target.files ?? [])]); e.target.value = ""; }} /></label>
        {picked.length > 0 && (
          <div className="w-all">
            <p className="faint">선택한 파일 {picked.length}개 — {card ? "주제 1개가 목록 1줄로 등록됩니다" : "원고 1개가 목록 1줄로 등록됩니다"}. 썸네일을 누르면 전체 내용을 볼 수 있습니다{tooBig ? ` · 30MB가 넘는 ${tooBig}개는 올라가지 않습니다` : ""}</p>
            <FileThumbs files={picked.map((x) => ({ id: x.id, name: x.file.name, url: x.url, mime: x.file.type || null, size: x.file.size }))} onRemove={unpick} />
          </div>
        )}
        <div className="w-all review-after" role="radiogroup" aria-label="등록 후 상태">
          <label className="check-row"><input type="radio" name="after" value="request" defaultChecked /> 바로 광고주에게 검수 요청</label>
          <label className="check-row"><input type="radio" name="after" value="complete" /> 이미 확정된 콘텐츠 — 검수 완료로 등록</label>
          <label className="check-row"><input type="radio" name="after" value="draft" /> 작성 중으로 두기</label>
        </div>
        <div className="st-act"><button className="btn primary" disabled={busy}>{busy ? "올리는 중…" : "등록"}</button><button type="button" className="btn" onClick={() => { clear(); setOpen(false); }}>취소</button></div>
      </div>
    </form>
  );
}

// 상세 화면: 상태에 맞는 직원 작업
export function ReviewStaffActions({ clientId, itemId, status, version, hasDraftFiles, pendingNext, base, title, kind, period }: {
  clientId: string; itemId: string; status: string; version: number; hasDraftFiles: boolean; pendingNext: number; base: string;
  title: string; kind: string; period: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const sb = supabaseBrowser();
  const nextVersion = status === "draft" ? version : version + 1;

  // v: 지금 버전(파일 교체) 또는 다음 버전(수정본)
  async function add(files: File[], v: number) {
    if (!files.length) return;
    setBusy(true);
    const ok = await uploadFiles(clientId, itemId, v, files);
    setBusy(false);
    toast(`${v > version ? `${v}차 수정본으로 ` : ""}파일 ${ok}개를 올렸습니다.`); router.refresh();
  }
  async function request() {
    setBusy(true);
    const { error } = await sb.rpc("review_request", { p_item: itemId });
    setBusy(false);
    if (error) return toastError(/no files/.test(error.message) ? "파일을 먼저 올려 주세요." : "검수를 요청하지 못했습니다.");
    toast("광고주에게 검수를 요청했습니다."); router.refresh();
  }
  async function resubmit() {
    const comment = window.prompt("수정 내용 메모 (광고주에게 보입니다, 비워도 됩니다)", "") ?? "";
    setBusy(true);
    const { error } = await sb.rpc("review_request", { p_item: itemId, p_new_version: true, p_comment: comment });
    setBusy(false);
    if (error) return toastError(/no files/.test(error.message) ? `${nextVersion}차 수정본 파일을 먼저 올려 주세요.` : "수정본 검수를 요청하지 못했습니다.");
    toast(`${nextVersion}차 수정본으로 검수를 요청했습니다.`); router.refresh();
  }
  // 이미 광고주와 확정한 콘텐츠: 광고주 검수 없이 담당자가 완료로 표시 (기록에 '담당자 완료 처리'로 남음)
  async function complete() {
    if (!hasDraftFiles) return toastError("파일을 먼저 올려 주세요.");
    if (!await ask(`${version}차 원고를 검수 완료로 표시할까요?\n이미 광고주와 확정된 콘텐츠일 때 사용하세요. 기록에 '담당자 완료 처리'로 남습니다.`)) return;
    setBusy(true);
    const { error } = await sb.rpc("review_staff_complete", { p_item: itemId });
    setBusy(false);
    if (error) return toastError(/no files/.test(error.message) ? "파일을 먼저 올려 주세요." : "완료 처리하지 못했습니다.");
    toast("검수 완료로 표시했습니다."); router.refresh();
  }
  async function remove() {
    if (await removeReviewItem(itemId, title, status)) { router.push(`${base}/review`); router.refresh(); }
  }

  return (
    <section className="card pad sec-tools">
      <div className="st-head">
        <div className="st-sum"><span className="badge acc">직원용</span>
          <span className="faint">{status === "draft" ? "작성 중 — 파일을 확인하고 검수를 요청하세요." : status === "changes" ? "재검수 요청 상태입니다. 수정본을 올리고 수정본 검수 요청을 보내세요." : status === "pending" ? "광고주 검수 대기 중입니다." : "검수 완료. 수정이 생기면 수정본을 올려 다시 검수받을 수 있습니다."}</span>
        </div>
        <div className="row">
          {status !== "draft" && <label className={`btn sm ${busy ? "disabled" : ""}`} title="지금 원고의 파일을 지운 뒤 새 파일로 바꿀 때">+ {version}차 원고에 파일 추가
            <input type="file" hidden multiple accept={ACCEPT} onChange={(e) => { add([...(e.target.files ?? [])], version); e.target.value = ""; }} />
          </label>}
          <label className={`btn sm ${busy ? "disabled" : ""}`}>{status === "draft" ? "+ 파일 추가" : `+ ${nextVersion}차 수정본 파일 올리기`}
            <input type="file" hidden multiple accept={ACCEPT} onChange={(e) => { add([...(e.target.files ?? [])], nextVersion); e.target.value = ""; }} />
          </label>
          {status === "draft" && <button className="btn sm primary" disabled={busy || !hasDraftFiles} onClick={request}>검수 요청</button>}
          {status !== "draft" && <button className="btn sm primary" disabled={busy || pendingNext === 0} onClick={resubmit} title={pendingNext ? "" : "수정본 파일을 먼저 올리세요"}>수정본 검수 요청{pendingNext ? ` (${pendingNext}개 파일)` : ""}</button>}
          {status !== "approved" && <button className="btn sm decide-ok" disabled={busy || !hasDraftFiles} onClick={complete} title="이미 확정된 콘텐츠를 완료로 표시">✓ 완료 처리</button>}
          <button className="btn sm" disabled={busy} onClick={() => setEditing(true)}>수정</button>
          <button className="btn sm" disabled={busy} onClick={remove}>삭제</button>
        </div>
      </div>
      {editing && <ReviewEditDialog item={{ id: itemId, title, kind, period }} onClose={() => setEditing(false)} />}
    </section>
  );
}

// 제목 · 구분 · 대상 월 수정 창 (목록 · 상세 공용). 저장된 행을 다시 받아 실제로 바뀌었는지 확인하고 결과를 알려 준다
export function ReviewEditDialog({ item, onClose }: { item: { id: string; title: string; kind: string; period: string }; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = { title: String(fd.get("title") ?? "").trim().slice(0, 200), kind: String(fd.get("kind")), period: String(fd.get("period")) };
    if (!next.title) return setErr("제목을 입력해 주세요.");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next.period)) return setErr("대상 월을 선택해 주세요.");
    if (next.title === item.title && next.kind === item.kind && next.period === item.period) return setErr("바뀐 내용이 없습니다.");
    setBusy(true); setErr("");
    const { data, error } = await supabaseBrowser().from("review_items").update({ ...next, updated_at: new Date().toISOString() }).eq("id", item.id).select("id");
    setBusy(false);
    if (error || !data?.length) return setErr("저장하지 못했습니다. 새로 고친 뒤 다시 시도해 주세요.");
    const moved = next.period !== item.period ? ` 대상 월을 ${next.period.replace("-", "년 ")}월로 옮겨 그 달 목록에서 보입니다.` : "";
    toast(`‘${next.title}’ 수정을 저장했습니다.${moved}`);
    onClose(); router.refresh();
  }
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="검수 콘텐츠 수정">
      <div className="modal-backdrop" onClick={onClose} />
      <form className="modal-panel review-edit" onSubmit={save}>
        <button type="button" className="modal-x" onClick={onClose} aria-label="닫기">×</button>
        <h3>검수 콘텐츠 수정</h3>
        <div className="st-form mt-s">
          <label className="w-all">제목<input name="title" defaultValue={item.title} required maxLength={200} className="search" autoFocus /></label>
          <label>구분<select name="kind" defaultValue={item.kind}>{KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>대상 월<input name="period" type="month" defaultValue={item.period} required className="search" /></label>
          {err && <p className="w-all form-err" role="alert">{err}</p>}
          <div className="st-act"><button className="btn primary" disabled={busy}>{busy ? "저장 중…" : "저장"}</button><button type="button" className="btn" onClick={onClose}>취소</button></div>
        </div>
      </form>
    </div>
  );
}

// 검수 콘텐츠 삭제 (상태와 관계없이): 파일 · 검수 기록도 함께 지워진다. 기록을 먼저 지운 뒤 저장소 파일을 지운다
export async function removeReviewItem(itemId: string, title: string, status: string) {
  const warn = status === "draft" ? "올린 파일도 함께 지워집니다." : "올린 파일과 검수 기록(요청 · 완료 · 코멘트)이 모두 지워지고 되돌릴 수 없습니다.";
  if (!await ask(`‘${title}’을(를) 삭제할까요?\n${warn}`)) return false;
  const sb = supabaseBrowser();
  const { data: files } = await sb.from("review_files").select("storage_path, original_path").eq("item_id", itemId);
  const { data, error } = await sb.from("review_items").delete().eq("id", itemId).select("id");
  if (error || !data?.length) { toastError("삭제하지 못했습니다."); return false; }
  // 화면에서 고친 원고는 처음 원본(original_path)도 함께 지운다
  const paths = (files ?? []).flatMap((f) => [f.storage_path, f.original_path].filter((x): x is string => !!x));
  if (paths.length) await sb.storage.from("reviews").remove(paths);
  toast("삭제했습니다.");
  return true;
}

// 광고주 로그인 이메일 (광고주 링크에서 이 이메일만 입력해 로그인한다)
export function ClientAccounts({ clientId, accounts }: { clientId: string; accounts: { user_id: string; name: string | null; email: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const sb = supabaseBrowser();
  const fnErr = async (e: unknown, fb: string) => { try { const j = await (e as { context?: Response }).context?.json(); return (j?.error as string) ?? fb; } catch { return fb; } };

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    setBusy(true);
    const { data, error } = await sb.functions.invoke("client-account", { body: { action: "create", clientId, email: String(fd.get("email")).trim(), name: String(fd.get("name") ?? "").trim() } });
    setBusy(false);
    if (error) return toastError(await fnErr(error, "이메일을 등록하지 못했습니다."));
    form.reset(); setCopied(false); setAdded(data.email); router.refresh();
  }
  async function remove(userId: string, email: string) {
    if (!await ask(`${email} 등록을 삭제할까요?
이 이메일로 더 이상 리포트에 로그인할 수 없습니다. 지난 검수 기록은 남습니다.`)) return;
    setBusy(true);
    const { error } = await sb.functions.invoke("client-account", { body: { action: "remove", userId } });
    setBusy(false);
    if (error) return toastError(await fnErr(error, "삭제하지 못했습니다."));
    toast("삭제했습니다."); router.refresh();
  }
  const text = added ? `[믿는구석] 마케팅 리포트 안내

전달드린 광고주 링크를 열고 아래 이메일을 입력하면 바로 리포트를 볼 수 있습니다.
로그인 이메일: ${added}` : "";

  return (
    <details className="card pad review-accounts">
      <summary><b>광고주 로그인 이메일</b> <span className="faint">{accounts.length ? `${accounts.length}개` : "없음 — 광고주가 링크로 리포트를 보려면 이메일 등록이 필요합니다"}</span></summary>
      <ul className="list mt-s">
        {accounts.map((a) => (
          <li key={a.user_id}>
            <span><b>{a.name ?? a.email}</b> <span className="faint">{a.email}</span></span>
            <span className="row"><button className="btn sm" disabled={busy} onClick={() => remove(a.user_id, a.email)}>삭제</button></span>
          </li>
        ))}
      </ul>
      <form className="st-form mt-s" onSubmit={create} autoComplete="off">
        <label>담당자 이름<input name="name" maxLength={40} className="search" placeholder="예: 배석현 원장" /></label>
        <label className="w2">이메일<input name="email" type="email" required maxLength={200} className="search" placeholder="광고주 담당자 이메일" /></label>
        <div className="st-act"><button className="btn sm primary" disabled={busy}>이메일 등록</button></div>
      </form>
      {added && (
        <div className="invite-box mt-s">
          <p className="faint">{added} 를 등록했습니다. 광고주 링크와 함께 이 이메일로 로그인하라고 안내해 주세요.</p>
          <div className="row mt-s"><button className="btn sm primary" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }}>{copied ? "복사했습니다" : "안내 문구 복사"}</button><button className="btn sm" onClick={() => setAdded(null)}>닫기</button></div>
        </div>
      )}
    </details>
  );
}
