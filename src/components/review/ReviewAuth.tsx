"use client";
// 파일 검수 로그인 (광고주 계정) · 첫 로그인 비밀번호 변경 · 로그아웃
// 리포트 보기는 링크로 열리지만, 검수 완료 · 수정 요청은 이 로그인을 해야 할 수 있다.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { toast, toastError } from "@/components/ui";

const RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/;

export function ReviewLogin({ clientName, other }: { clientName: string; other: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const sb = supabaseBrowser();
    if (other) await sb.auth.signOut();
    const { error } = await sb.auth.signInWithPassword({ email: String(fd.get("email") ?? "").trim(), password: String(fd.get("password") ?? "") });
    setBusy(false);
    if (error) return toastError("이메일 또는 비밀번호가 맞지 않습니다.");
    router.refresh();
  }
  return (
    <section className="card pad review-login">
      <h2>파일 검수 로그인</h2>
      <p className="faint">{clientName} 담당자 계정으로 로그인하면 콘텐츠를 확인하고 검수 완료 · 수정 요청을 할 수 있습니다. 계정은 믿는구석 담당자가 발급해 드립니다.</p>
      {other && <div className="notice mt-s">지금 로그인한 계정은 {clientName} 검수 계정이 아닙니다. 검수 계정으로 다시 로그인해 주세요.</div>}
      <form className="login-form" onSubmit={login}>
        <input name="email" type="email" required placeholder="이메일" className="search" autoComplete="username" />
        <input name="password" type="password" required placeholder="비밀번호" className="search" autoComplete="current-password" />
        <button className="btn primary" disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
      </form>
    </section>
  );
}

export function ReviewChangePassword() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function change(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const pw = String(fd.get("pw") ?? ""), pw2 = String(fd.get("pw2") ?? "");
    if (!RULE.test(pw)) return toastError("비밀번호는 10자 이상, 영문 대·소문자와 숫자를 포함해야 합니다.");
    if (pw !== pw2) return toastError("두 비밀번호가 다릅니다.");
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.updateUser({ password: pw });
    if (!error) await sb.rpc("client_user_password_changed");
    setBusy(false);
    if (error) return toastError("비밀번호를 바꾸지 못했습니다.");
    toast("비밀번호를 바꿨습니다.");
    router.refresh();
  }
  return (
    <section className="card pad review-login">
      <h2>새 비밀번호 설정</h2>
      <p className="faint">처음 로그인하셨습니다. 임시 비밀번호를 새 비밀번호로 바꿔 주세요.</p>
      <form className="login-form" onSubmit={change}>
        <input name="pw" type="password" required placeholder="새 비밀번호 (10자 이상, 대·소문자·숫자)" className="search" autoComplete="new-password" />
        <input name="pw2" type="password" required placeholder="새 비밀번호 확인" className="search" autoComplete="new-password" />
        <button className="btn primary" disabled={busy}>{busy ? "저장 중…" : "비밀번호 저장"}</button>
      </form>
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
