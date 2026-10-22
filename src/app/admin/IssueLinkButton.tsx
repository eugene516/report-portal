"use client";
// 광고주 링크 발급: 발급 직후 링크를 한 번만 보여주고, 화면을 새로 고쳐 다른 곳의 "발급 완료" 표시도 바로 바뀌게 한다
import { ask } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { issueClientLink } from "./actions";

export default function IssueLinkButton({ clientId, issued = false, primary = false }: { clientId: string; issued?: boolean; primary?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [months, setMonths] = useState(6);   // 사용 기간 (기본 6개월)
  return (
    <span className="issue-link">
      <span className="row issue-row">
      <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="링크 사용 기간" className="sm-select">
        <option value={3}>3개월</option><option value={6}>6개월</option><option value={12}>1년</option><option value={0}>무기한</option>
      </select>
      <button className={`btn sm ${primary ? "primary" : ""}`} disabled={pending} onClick={() => start(async () => {
        if (!await ask(issued ? "광고주 링크를 새로 발급할까요?\n이미 보낸 링크도 계속 쓸 수 있으며, 필요 없으면 광고주 설정에서 폐기하세요.\n새 링크는 지금 한 번만 표시됩니다." :"광고주 링크를 발급할까요? 링크는 지금 한 번만 표시됩니다.")) return;
        const r = await issueClientLink(clientId, months);
        setUrl(r.url ?? null); setError(r.error ?? null); setCopied(false);
        if (r.url) router.refresh();
      })}>{issued ? "링크 새로 발급" : "광고주 링크 발급"}</button>
      </span>
      {url && (
        <span className="link-once">
          <input readOnly value={url} className="search" onFocus={(e) => e.currentTarget.select()} />
          <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } }}>{copied ? "복사했습니다" : "복사"}</button>
          <span className="faint">이 링크는 다시 볼 수 없습니다. 지금 복사해 광고주에게 전달하세요.</span>
        </span>
      )}
      {error && <span className="notice">{error}</span>}
    </span>
  );
}
