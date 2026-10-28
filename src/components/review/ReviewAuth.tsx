"use client";
// 광고주 로그인 (광고주 링크 화면) · 로그아웃
// 광고주 링크를 열고 그 광고주에 등록된 이메일만 입력하면 바로 로그인된다 (비밀번호 · 메일 인증 없음).
// 링크 토큰 · 이메일 확인과 로그인 토큰 발급은 client-login 함수가 한다.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { toastError } from "@/components/ui";

export function ClientEmailLogin({ token, clientName, other = false }: { token: string | null; clientName: string; other?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    setBusy(true);
    const sb = supabaseBrowser();
    const { data, error } = await sb.functions.invoke("client-login", { body: { token, email } });
    if (error || !data?.tokenHash) {
      setBusy(false);
      let msg = "로그인하지 못했습니다.";
      try { msg = (await (error as { context?: Response })?.context?.json())?.error ?? msg; } catch { /* 기본 문구 */ }
      return toastError(msg);
    }
    if (other) await sb.auth.signOut();
    const { error: e2 } = await sb.auth.verifyOtp({ token_hash: data.tokenHash, type: "magiclink" });
    setBusy(false);
    if (e2) return toastError("로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    router.refresh();
  }
  return (
    <section className="card pad review-login">
      <h2>{clientName} 리포트 로그인</h2>
      {token
        ? <p className="faint">믿는구석에 등록된 담당자 이메일을 입력하면 바로 리포트를 볼 수 있습니다. 이메일 등록은 믿는구석 담당자에게 요청해 주세요.</p>
        : <p className="faint">광고주는 광고주 링크에서 등록된 이메일을 입력해 로그인합니다. 미리보기에서는 로그인할 수 없습니다.</p>}
      {other && <div className="notice mt-s">지금 로그인한 계정은 {clientName}에 등록된 이메일이 아닙니다. 등록된 이메일로 다시 로그인해 주세요.</div>}
      {token && (
        <form className="login-form" method="post" onSubmit={login}>
          <input name="email" type="email" required placeholder="등록된 이메일" className="search" autoComplete="email" maxLength={200} autoFocus />
          <button className="btn primary" disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
        </form>
      )}
    </section>
  );
}

export function ReviewLogout({ name }: { name: string }) {
  const router = useRouter();
  return (
    <span className="row review-who">
      <span className="faint">{name} 님 로그인</span>
      <button className="btn sm" onClick={async () => { await supabaseBrowser().auth.signOut(); router.refresh(); }}>로그아웃</button>
    </span>
  );
}
