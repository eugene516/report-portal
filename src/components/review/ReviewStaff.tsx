"use client";
// 직원: 파일 검수 관리 — 콘텐츠 등록(유형 · 월 · 제목 · Word · 이미지) → 검수 요청 → 수정 요청 확인 → 수정본 등록(새 버전) → 재검수 요청
// 검수 완료는 광고주가 처리한다 (직원이 직접 입력하지 않음). 저장소 · 표 규칙이 담당 여부와 버전을 다시 확인한다
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ask, toast, toastError } from "@/components/ui";

const KINDS = [["blog", "블로그"], ["column", "홈페이지 칼럼"], ["cardnews", "SNS 카드뉴스"], ["etc", "기타"]] as const;
const ACCEPT = ".docx,.doc,.pdf,.hwp,.txt,image/png,image/jpeg,image/webp,image/gif";
const safe = (name: string) => name.replace(/[^\w.\-가-힣 ()]/g, "_").slice(-100);

async function uploadFiles(clientId: string, itemId: string, version: number, files: File[]) {
  const sb = supabaseBrowser();
  let ok = 0;
  for (const [i, f] of files.entries()) {
    if (f.size > 30 * 1024 * 1024) continue;
    const ext = (f.name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "").toLowerCase();
    const path = `${clientId}/${itemId}/v${version}/${crypto.randomUUID()}${ext}`;
    const up = await sb.storage.from("reviews").upload(path, f, { contentType: f.type || undefined, upsert: false });
    if (up.error) continue;
    const { error } = await sb.from("review_files").insert({ item_id: itemId, client_id: clientId, version, file_name: safe(f.name), storage_path: path, mime_type: f.type || null, size_bytes: f.size, sort: i });
    if (error) { await sb.storage.from("reviews").remove([path]); continue; }
    ok++;
  }
  return ok;
}

// 목록 화면 위: 새 콘텐츠 등록
export function ReviewCreate({ clientId, period }: { clientId: string; period: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    const files = (fd.getAll("files") as File[]).filter((f) => f.size > 0);
    if (!files.length) return toastError("원고나 이미지 파일을 하나 이상 올려 주세요.");
    setBusy(true);
    const sb = supabaseBrowser();
    const { data, error } = await sb.from("review_items").insert({ client_id: clientId, kind: String(fd.get("kind")), period: String(fd.get("period")), title: String(fd.get("title")).trim() }).select("id").single();
    if (error || !data) { setBusy(false); return toastError("콘텐츠를 만들지 못했습니다."); }
    const ok = await uploadFiles(clientId, data.id, 1, files);
    let msg = `콘텐츠를 등록했습니다 (파일 ${ok}개).`;
    if (fd.get("request") && ok) {
      const { error: e2 } = await sb.rpc("review_request", { p_item: data.id });
      msg = e2 ? msg + " 검수 요청은 하지 못했습니다." : `검수를 요청했습니다 (파일 ${ok}개). 광고주 파일 검수 화면에 바로 보입니다.`;
    }
    setBusy(false); form.reset(); setOpen(false);
    toast(msg); router.refresh();
  }
  if (!open) return <button className="btn primary" onClick={() => setOpen(true)}>+ 검수 콘텐츠 등록</button>;
  return (
    <form className="card pad review-create" onSubmit={create}>
      <h3>검수 콘텐츠 등록</h3>
      <div className="st-form">
        <label>유형<select name="kind" defaultValue="blog">{KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>대상 월<input name="period" type="month" defaultValue={period} required className="search" /></label>
        <label className="w2">콘텐츠 제목<input name="title" required maxLength={200} className="search" placeholder="예: 백내장 초기 증상" /></label>
        <label className="w-all">원고 · 이미지 (여러 개 선택, 파일당 30MB 이하)<input name="files" type="file" multiple accept={ACCEPT} className="search" /></label>
        <label className="w-all check-row"><input type="checkbox" name="request" defaultChecked /> 등록하면서 바로 광고주에게 검수 요청</label>
        <div className="st-act"><button className="btn primary" disabled={busy}>{busy ? "올리는 중…" : "등록"}</button><button type="button" className="btn" onClick={() => setOpen(false)}>취소</button></div>
      </div>
    </form>
  );
}

// 상세 화면: 상태에 맞는 직원 작업
export function ReviewStaffActions({ clientId, itemId, status, version, hasDraftFiles, pendingNext, base }: {
  clientId: string; itemId: string; status: string; version: number; hasDraftFiles: boolean; pendingNext: number; base: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const sb = supabaseBrowser();
  const nextVersion = status === "draft" ? version : version + 1;

  async function add(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    const ok = await uploadFiles(clientId, itemId, nextVersion, files);
    setBusy(false);
    toast(`${status === "draft" ? "" : `${nextVersion}차 수정본으로 `}파일 ${ok}개를 올렸습니다.`); router.refresh();
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
    if (error) return toastError(/no files/.test(error.message) ? `${nextVersion}차 수정본 파일을 먼저 올려 주세요.` : "재검수를 요청하지 못했습니다.");
    toast(`${nextVersion}차 수정본으로 재검수를 요청했습니다.`); router.refresh();
  }
  async function removeDraft() {
    if (!await ask("작성 중인 콘텐츠를 삭제할까요?\n올린 파일도 함께 지워집니다.")) return;
    const { data: files } = await sb.from("review_files").select("storage_path").eq("item_id", itemId);
    const { error } = await sb.from("review_items").delete().eq("id", itemId);
    if (error) return toastError("삭제하지 못했습니다.");
    if (files?.length) await sb.storage.from("reviews").remove(files.map((f) => f.storage_path));
    toast("삭제했습니다."); router.push(`${base}/review`); router.refresh();
  }

  return (
    <section className="card pad sec-tools">
      <div className="st-head">
        <div className="st-sum"><span className="badge acc">직원용</span>
          <span className="faint">{status === "draft" ? "작성 중 — 파일을 확인하고 검수를 요청하세요." : status === "changes" ? "광고주가 수정을 요청했습니다. 수정본을 올리고 재검수를 요청하세요." : status === "pending" ? "광고주 검수 대기 중입니다." : "검수 완료. 수정이 생기면 수정본을 올려 다시 검수받을 수 있습니다."}</span>
        </div>
        <div className="row">
          <label className={`btn sm ${busy ? "disabled" : ""}`}>{status === "draft" ? "+ 파일 추가" : `+ ${nextVersion}차 수정본 파일 올리기`}
            <input type="file" hidden multiple accept={ACCEPT} onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
          {status === "draft" && <button className="btn sm primary" disabled={busy || !hasDraftFiles} onClick={request}>검수 요청</button>}
          {status !== "draft" && <button className="btn sm primary" disabled={busy || pendingNext === 0} onClick={resubmit} title={pendingNext ? "" : "수정본 파일을 먼저 올리세요"}>재검수 요청{pendingNext ? ` (${pendingNext}개 파일)` : ""}</button>}
          {status === "draft" && <button className="btn sm" disabled={busy} onClick={removeDraft}>삭제</button>}
        </div>
      </div>
    </section>
  );
}

// 광고주 계정 (파일 검수 로그인용)
export function ClientAccounts({ clientId, accounts, loginUrl }: { clientId: string; accounts: { user_id: string; name: string | null; email: string; must_change_password: boolean }[]; loginUrl: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ email: string; pw: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const sb = supabaseBrowser();
  const fnErr = async (e: unknown, fb: string) => { try { const j = await (e as { context?: Response }).context?.json(); return (j?.error as string) ?? fb; } catch { return fb; } };

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    setBusy(true);
    const { data, error } = await sb.functions.invoke("client-account", { body: { action: "create", clientId, email: String(fd.get("email")).trim(), name: String(fd.get("name") ?? "").trim() } });
    setBusy(false);
    if (error) return toastError(await fnErr(error, "계정을 만들지 못했습니다."));
    form.reset(); setCopied(false); setIssued({ email: data.email, pw: data.tempPassword }); router.refresh();
  }
  async function reset(userId: string, email: string) {
    if (!await ask(`${email} 의 임시 비밀번호를 다시 발급할까요?\n지금 비밀번호로는 더 이상 로그인할 수 없습니다.`)) return;
    setBusy(true);
    const { data, error } = await sb.functions.invoke("client-account", { body: { action: "reset", userId } });
    setBusy(false);
    if (error) return toastError(await fnErr(error, "재발급하지 못했습니다."));
    setCopied(false); setIssued({ email: data.email, pw: data.tempPassword }); router.refresh();
  }
  async function remove(userId: string, email: string) {
    if (!await ask(`${email} 계정을 삭제할까요?\n이 계정으로 더 이상 검수할 수 없습니다. 지난 검수 기록은 남습니다.`)) return;
    setBusy(true);
    const { error } = await sb.functions.invoke("client-account", { body: { action: "remove", userId } });
    setBusy(false);
    if (error) return toastError(await fnErr(error, "삭제하지 못했습니다."));
    toast("계정을 삭제했습니다."); router.refresh();
  }
  const text = issued ? `[믿는구석] 콘텐츠 파일 검수 안내\n\n리포트 링크에서 '파일 검수' 메뉴를 열고 아래 계정으로 로그인해 주세요.\n아이디: ${issued.email}\n임시 비밀번호: ${issued.pw}\n\n첫 로그인 후 새 비밀번호로 바꿔 주세요.` : "";

  return (
    <details className="card pad review-accounts">
      <summary><b>광고주 검수 계정</b> <span className="faint">{accounts.length ? `${accounts.length}개` : "없음 — 광고주가 검수하려면 계정이 필요합니다"}</span></summary>
      <ul className="list mt-s">
        {accounts.map((a) => (
          <li key={a.user_id}>
            <span><b>{a.name ?? a.email}</b> <span className="faint">{a.email}</span> {a.must_change_password && <span className="badge warn">첫 로그인 전</span>}</span>
            <span className="row"><button className="btn sm" disabled={busy} onClick={() => reset(a.user_id, a.email)}>임시 비밀번호 재발급</button><button className="btn sm" disabled={busy} onClick={() => remove(a.user_id, a.email)}>삭제</button></span>
          </li>
        ))}
      </ul>
      <form className="st-form mt-s" onSubmit={create} autoComplete="off">
        <label>담당자 이름<input name="name" maxLength={40} className="search" placeholder="예: 배석현 원장" /></label>
        <label className="w2">이메일<input name="email" type="email" required className="search" placeholder="광고주 담당자 이메일" /></label>
        <div className="st-act"><button className="btn sm primary" disabled={busy}>계정 만들기</button></div>
      </form>
      {issued && (
        <div className="invite-box mt-s">
          <p className="faint">이 화면을 벗어나면 임시 비밀번호를 다시 볼 수 없습니다. 광고주 링크와 함께 전달해 주세요. (로그인 위치: {loginUrl})</p>
          <table><tbody><tr><td className="faint">아이디</td><td><code>{issued.email}</code></td></tr><tr><td className="faint">임시 비밀번호</td><td><code className="big">{issued.pw}</code></td></tr></tbody></table>
          <div className="row mt-s"><button className="btn sm primary" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }}>{copied ? "복사했습니다" : "안내 문구 복사"}</button><button className="btn sm" onClick={() => setIssued(null)}>닫기</button></div>
        </div>
      )}
    </details>
  );
}
