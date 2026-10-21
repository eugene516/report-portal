"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false, // 등록된 직원만 로그인 가능 (새 계정 자동 생성 안 함)
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    // 등록 여부를 구분해 알려주지 않는다 (직원 이메일 목록 추측 방지)
    setState(error && !/signups not allowed|not found|user/i.test(error.message) ? "error" : "sent");
  }

  if (state === "sent") {
    return <div className="planned mt">등록된 직원 이메일이면 로그인 링크가 발송됩니다. 메일함을 확인해 주세요.</div>;
  }
  return (
    <form onSubmit={submit} className="login-form">
      <label htmlFor="email" className="faint">직원 이메일</label>
      <input id="email" type="email" required autoComplete="email" className="search" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@believe-corner.com" />
      <button className="btn primary" disabled={state === "sending"}>{state === "sending" ? "보내는 중…" : "로그인 링크 받기"}</button>
      {state === "error" && <div className="notice">잠시 후 다시 시도해 주세요.</div>}
    </form>
  );
}
