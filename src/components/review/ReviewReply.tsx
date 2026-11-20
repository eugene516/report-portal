"use client";
// 광고주 코멘트에 달린 담당자 답글 + (직원) 답글 쓰기
// 답글은 review_reply 함수로만 남는다 (담당 직원 · 관리자). 광고주는 답글을 읽기만 한다
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
  // 답글은 광고주가 남긴 코멘트에만
  const can = staff && parent.actor_kind === "client" && !!parent.comment && parent.action !== "reply";
  if (!replies.length && !can) return null;

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("review_reply", { p_event: parent.id, p_comment: text.trim() });
    setBusy(false);
    if (error) return toastError("답글을 남기지 못했습니다. 잠시 후 다시 시도해 주세요.");
    setText(""); setOpen(false); toast("답글을 남겼습니다. 광고주 화면에도 보입니다."); router.refresh();
  }

  return (
    <div className="rv-replies">
      {replies.map((r) => (
        <div key={r.id} className="rv-reply">
          <span className="rv-reply-h"><b>↳ {r.actor_name ?? "담당자"}</b> <span className="faint">담당자 답글 · {kst(r.created_at)}</span></span>
          <span className="rv-reply-t">{r.comment}</span>
        </div>
      ))}
      {can && (open ? (
        <div className="rv-reply-form">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} autoFocus placeholder="광고주에게 보일 답글을 적어 주세요" aria-label="답글"
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
