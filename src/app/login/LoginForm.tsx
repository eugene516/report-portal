"use client";
// 직원 로그인: 이메일 + 비밀번호
// - 실패 사유(없는 이메일 / 틀린 비밀번호)를 구분하지 않는다 (직원 이메일 추측 방지)
// - 로그인 시도 횟수 제한은 Supabase Auth 가 적용한다
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginForm({ email = "" }: { email?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email: String(fd.get("email") ?? "").trim(),
      password: String(fd.get("password") ?? ""),
    });
    setBusy(false);
    if (error) {
      setError(/rate|too many/i.test(error.message)
        ? "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."
        : "이메일 또는 비밀번호가 올바르지 않습니다.");
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  // method="post": 스크립트가 안 돌 때도 비밀번호가 주소창 · 기록에 남지 않도록
  return (
    <form onSubmit={submit} method="post" className="login-form">
      <label htmlFor="email" className="faint">직원 이메일</label>
      <input id="email" name="email" type="email" required autoComplete="username" className="search" placeholder="name@believe-corner.com" defaultValue={email} />
      <label htmlFor="password" className="faint">비밀번호</label>
      <input id="password" name="password" type="password" required autoComplete="current-password" className="search" autoFocus={!!email} />
      <button className="btn primary" disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
      {error && <div className="notice">{error}</div>}
    </form>
  );
}
