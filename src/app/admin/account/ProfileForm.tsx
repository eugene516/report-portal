"use client";
// 이름 변경 (이메일·권한은 관리자만 바꿀 수 있어 읽기 전용)
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function ProfileForm({ email, name, role }: { email: string; name: string; role: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    if (!v) { setMsg({ ok: false, text: "이름을 입력해 주세요." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabaseBrowser().rpc("update_my_profile", { p_name: v });
    setBusy(false);
    setMsg(error ? { ok: false, text: "이름을 저장하지 못했습니다." } : { ok: true, text: "이름을 저장했습니다." });
    if (!error) router.refresh();
  }

  return (
    <form onSubmit={submit} className="login-form">
      <label className="faint" htmlFor="pf-email">이메일 (로그인 아이디)</label>
      <input id="pf-email" value={email} readOnly disabled className="search" />
      <label className="faint" htmlFor="pf-role">권한</label>
      <input id="pf-role" value={role} readOnly disabled className="search" />
      <label className="faint" htmlFor="pf-name">이름</label>
      <input id="pf-name" name="name" defaultValue={name} required maxLength={40} className="search" />
      <button className="btn" disabled={busy}>{busy ? "저장 중…" : "이름 저장"}</button>
      {msg && <div className={msg.ok ? "planned" : "notice"}>{msg.text}</div>}
    </form>
  );
}
