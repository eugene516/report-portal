"use client";
// 비밀번호 변경: 현재(임시) 비밀번호를 한 번 더 확인한 뒤 바꾼다
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

const RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/;

export default function PasswordForm({ email, first }: { email: string; first: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const cur = String(fd.get("current") ?? "");
    const pw = String(fd.get("password") ?? "");
    const pw2 = String(fd.get("confirm") ?? "");
    if (pw !== pw2) { setMsg({ ok: false, text: "새 비밀번호 두 개가 다릅니다." }); return; }
    if (!RULE.test(pw)) { setMsg({ ok: false, text: "10자 이상, 영문 대문자·소문자·숫자를 모두 포함해 주세요." }); return; }
    if (pw === cur) { setMsg({ ok: false, text: "현재 비밀번호와 다른 비밀번호를 입력해 주세요." }); return; }
    setBusy(true); setMsg(null);
    const sb = supabaseBrowser();
    const check = await sb.auth.signInWithPassword({ email, password: cur });
    if (check.error) {
      setBusy(false);
      setMsg({ ok: false, text: /rate|too many/i.test(check.error.message) ? "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." : "현재 비밀번호가 올바르지 않습니다." });
      return;
    }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (!error) await sb.rpc("mark_password_changed");
    setBusy(false);
    form.reset();
    if (error) {
      setMsg({ ok: false, text: /same|different/i.test(error.message) ? "이전과 다른 비밀번호를 입력해 주세요." : "변경하지 못했습니다. 다시 로그인한 뒤 시도해 주세요." });
      return;
    }
    if (first) { router.replace("/admin"); router.refresh(); return; }
    setMsg({ ok: true, text: "비밀번호를 변경했습니다." });
  }

  return (
    <form onSubmit={submit} className="login-form">
      <input type="email" name="username" autoComplete="username" value={email} hidden readOnly />
      <label className="faint" htmlFor="pw0">{first ? "임시 비밀번호" : "현재 비밀번호"}</label>
      <input id="pw0" name="current" type="password" required autoComplete="current-password" className="search" />
      <label className="faint" htmlFor="pw">새 비밀번호</label>
      <input id="pw" name="password" type="password" required autoComplete="new-password" className="search" />
      <label className="faint" htmlFor="pw2">새 비밀번호 확인</label>
      <input id="pw2" name="confirm" type="password" required autoComplete="new-password" className="search" />
      <button className="btn primary" disabled={busy}>{busy ? "변경 중…" : "비밀번호 변경"}</button>
      {msg && <div className={msg.ok ? "planned" : "notice"}>{msg.text}</div>}
    </form>
  );
}
