"use client";
// 담당자 운영 코멘트 편집 (직원 화면에서만 렌더링 — 광고주 링크 화면에는 읽기 전용 텍스트만 나간다)
// 저장은 로그인 세션으로 직접 하며, DB 규칙(can_access_client)이 담당 여부를 다시 확인한다.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function NoteEditor({ clientId, period, initial }: { clientId: string; period: string; initial: string }) {
  const router = useRouter();
  const [body, setBody] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  async function save() {
    setState("saving");
    const { error } = await supabaseBrowser().from("ad_report_notes").upsert({ client_id: clientId, channel: "naver", period, body: body.slice(0, 4000), updated_at: new Date().toISOString() });
    setState(error ? "error" : "saved");
    if (!error) router.refresh();
  }
  return (
    <>
      <textarea className="paste note-input" rows={9} value={body} maxLength={4000} onChange={(e) => { setBody(e.target.value); setState("idle"); }}
        placeholder={"광고주에게 보여줄 이번 달 운영 내용과 다음 액션을 적어 주세요.\n예) 성과 요약 / 주요 이슈 / 다음 달 액션"} />
      <div className="row mt-s">
        <button className="btn primary sm" disabled={state === "saving"} onClick={save}>{state === "saving" ? "저장 중…" : "코멘트 저장"}</button>
        <span className="faint">{period.replace("-", "년 ")}월 코멘트 · 광고주 리포트에 그대로 표시됩니다</span>
        {state === "saved" && <span className="badge good">저장됨</span>}
        {state === "error" && <span className="badge bad">저장 실패</span>}
      </div>
    </>
  );
}
