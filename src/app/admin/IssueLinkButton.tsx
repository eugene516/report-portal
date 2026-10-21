"use client";
import { useState, useTransition } from "react";
import { issueClientLink } from "./actions";

export default function IssueLinkButton({ clientId }: { clientId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="issue-link">
      <button className="btn sm" disabled={pending} onClick={() => start(async () => {
        if (!confirm("새 광고주 링크를 발급할까요? 링크는 지금 한 번만 표시됩니다.")) return;
        const r = await issueClientLink(clientId);
        setUrl(r.url ?? null); setError(r.error ?? null);
      })}>광고주 링크 발급</button>
      {url && (
        <span className="link-once">
          <input readOnly value={url} className="search" onFocus={(e) => e.currentTarget.select()} />
          <button className="btn sm" onClick={() => navigator.clipboard.writeText(url)}>복사</button>
          <span className="faint">이 링크는 다시 볼 수 없습니다. 지금 복사해 광고주에게 전달하세요.</span>
        </span>
      )}
      {error && <span className="notice">{error}</span>}
    </span>
  );
}
