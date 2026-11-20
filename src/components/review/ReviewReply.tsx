"use client";
// 코멘트 아래 답글 대화 (담당 직원 ↔ 광고주)
// 답글은 review_reply 함수로만 남는다 (담당 직원 · 관리자 · 그 병원 광고주 계정). 답글은 원래 코멘트 아래 한 줄기로 이어진다
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { toast, toastError } from "@/components/ui";
import type { ReviewEvent } from "@/lib/review";

const kst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ").replace("-", "/");

export default function ReviewReplies({ parent, events, staff }: { parent: ReviewEvent; events: ReviewEvent[]; staff: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const replies = events.filter((e) => e.reply_to === parent.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  // 이 화면은 직원 또는 로그인한 광고주 계정만 본다 → 코멘트가 있는 기록이면 누구나 답글 (원고 수정 기록 제외)
  const can = !!parent.comment && parent.action !== "reply" && parent.action !== "edit";
  if (!replies.length && !can) return null;

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("review_reply", { p_event: parent.id, p_comment: text.trim() });
    setBusy(false);
    if (error) return toastError("답글을 남기지 못했습니다. 잠시 후 다시 시도해 주세요.");
    setText(""); setOpen(false); toast(staff ? "답글을 남겼습니다. 광고주 화면에도 보입니다." : "답글을 남겼습니다. 담당자에게도 보입니다."); router.refresh();
  }

  return (
    <div className="rv-replies">
      {replies.map((r) => (
        <div key={r.id} className={`rv-reply ${r.actor_kind === "client" ? "from-client" : ""}`}>
          <span className="rv-reply-h"><b>↳ {r.actor_name ?? (r.actor_kind === "client" ? "광고주" : "담당자")}</b> <span className="faint">{r.actor_kind === "client" ? "광고주 답글" : "담당자 답글"} · {kst(r.created_at)}</span></span>
          <span className="rv-reply-t">{r.comment}</span>
        </div>
      ))}
      {can && (open ? (
        <div className="rv-reply-form">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} autoFocus placeholder={staff ? "광고주에게 보일 답글을 적어 주세요" : "담당자에게 보낼 답글을 적어 주세요"} aria-label="답글"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }} />
          <span className="row">
            <button type="button" className="btn sm" disabled={busy} onClick={() => { setOpen(false); setText(""); }}>취소</button>
            <button type="button" className="btn sm primary" disabled={busy || !text.trim()} onClick={send}>{busy ? "남기는 중…" : "답글 남기기"}</button>
          </span>
        </div>
      ) : <button type="button" className="linkish rv-reply-btn" onClick={() => setOpen(true)}>답글 달기</button>)}
    </div>
  );
}
