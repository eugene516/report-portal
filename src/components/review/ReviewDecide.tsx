"use client";
// 광고주: 검수 완료 · 재검수 요청 (콘텐츠 1건 = 검수 1건, 지금 버전에 대해)
// DB 함수가 로그인한 광고주 계정 · 버전 · 중복 승인을 다시 확인한다
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { confirmDialog, toast, toastError } from "@/components/ui";

export default function ReviewDecide({ itemId, version, title }: { itemId: string; version: number; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [comment, setComment] = useState("");

  async function decide(approve: boolean) {
    if (busy) return;
    if (approve && !(await confirmDialog({ title: "검수 완료로 처리할까요?", body: `“${title}” (${version}차 원고)\n검수 완료 후에는 이 버전을 기준으로 진행합니다.`, ok: "검수 완료" }))) return;
    if (!approve && !comment.trim()) return toastError("수정할 내용을 적어 주세요.");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("review_decide", { p_item: itemId, p_version: version, p_approve: approve, p_comment: approve ? null : comment.trim() });
    setBusy(false);
    if (error) return toastError(/stale/.test(error.message) ? "그 사이 수정본이 올라왔습니다. 새로 고쳐서 다시 확인해 주세요." : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    toast(approve ? "검수 완료로 처리했습니다." : "재검수 요청을 보냈습니다. 담당자가 수정본을 올리면 다시 확인하실 수 있습니다.");
    setWriting(false); setComment("");
    router.refresh();
  }

  return (
    <div className="review-decide">
      {writing ? (
        <div className="decide-box">
          <label>코멘트 (수정할 내용)<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={2000} placeholder="예: 두 번째 문단 내용을 수정해 주세요." autoFocus /></label>
          <div className="row"><button className="btn primary" disabled={busy} onClick={() => decide(false)}>{busy ? "보내는 중…" : "재검수 요청 보내기"}</button><button className="btn" onClick={() => setWriting(false)}>취소</button></div>
        </div>
      ) : (
        <div className="row decide-act">
          <button className="btn decide-ok" disabled={busy} onClick={() => decide(true)}>✓ 검수 완료</button>
          <button className="btn" disabled={busy} onClick={() => setWriting(true)}>재검수 요청</button>
        </div>
      )}
    </div>
  );
}
