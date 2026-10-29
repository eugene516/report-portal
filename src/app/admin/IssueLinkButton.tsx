"use client";
// 광고주 링크 발급 · 다시 보기 (client-link 함수: 담당 직원 · 오너 · 관리자)
// - 발급한 링크는 암호화해 저장하므로 '링크 보기'로 언제든 다시 확인 · 복사할 수 있다
// - 발급 후 화면을 새로 고쳐 다른 곳의 "발급 완료" 표시도 바로 바뀌게 한다
import { ask } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

async function callLink(body: Record<string, unknown>): Promise<{ url?: string; error?: string }> {
  const { data, error } = await supabaseBrowser().functions.invoke("client-link", { body });
  if (error || !data?.token) {
    let msg = data?.error as string | undefined;
    try { msg ??= (await (error as { context?: Response })?.context?.json())?.error; } catch { /* 본문 없음 */ }
    return { error: msg ?? "링크를 처리하지 못했습니다." };
  }
  return { url: `${window.location.origin}/r/${data.token}` };
}

function LinkBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="link-once">
      <input readOnly value={url} className="search" onFocus={(e) => e.currentTarget.select()} />
      <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } }}>{copied ? "복사했습니다" : "복사"}</button>
    </span>
  );
}

// 사용 중인 링크 다시 보기 (tokenId 없으면 가장 최근 링크)
export function LinkReveal({ clientId, tokenId }: { clientId: string; tokenId?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (url) return <LinkBox url={url} />;
  return (
    <>
      <button className="btn sm" disabled={pending} onClick={() => start(async () => {
        const r = await callLink({ action: "reveal", clientId, ...(tokenId ? { tokenId } : {}) });
        setUrl(r.url ?? null); setError(r.error ?? null);
      })}>링크 보기</button>
      {error && <span className="notice">{error}</span>}
    </>
  );
}

export default function IssueLinkButton({ clientId, issued = false, primary = false }: { clientId: string; issued?: boolean; primary?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [months, setMonths] = useState(6);   // 사용 기간 (기본 6개월)
  return (
    <span className="issue-link">
      <span className="row issue-row">
      {issued && !url && <LinkReveal clientId={clientId} />}
      <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="링크 사용 기간" className="sm-select">
        <option value={3}>3개월</option><option value={6}>6개월</option><option value={12}>1년</option><option value={0}>무기한</option>
      </select>
      <button className={`btn sm ${primary ? "primary" : ""}`} disabled={pending} onClick={async () => {
        // 확인 창은 전환(start) 밖에서 묻는다: 전환 안에서 띄우면 전환이 끝날 때까지 창이 그려지지 않아 멈춘다
        if (!await ask(issued ? "광고주 링크를 새로 발급할까요?\n이미 보낸 링크도 계속 쓸 수 있으며, 필요 없으면 광고주 설정에서 폐기하세요." : "광고주 링크를 발급할까요?")) return;
        start(async () => {
          const r = await callLink({ action: "issue", clientId, months });
          setUrl(r.url ?? null); setError(r.error ?? null);
          if (r.url) router.refresh();
        });
      }}>{issued ? "링크 새로 발급" : "광고주 링크 발급"}</button>
      </span>
      {url && <LinkBox url={url} />}
      {error && <span className="notice">{error}</span>}
    </span>
  );
}
