"use client";
// 직원 관리 화면
// - 계정 생성·비밀번호 재설정·비활성화: Supabase staff-admin 함수로 직접 전송 (웹 서버를 거치지 않음)
// - 관리자 지정·해제, 오너 양도: DB 함수(set_staff_role / transfer_ownership)가 권한을 다시 확인
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { StaffRow } from "@/lib/dashboard";

const ROLE: Record<string, string> = { owner: "오너", admin: "관리자", staff: "직원" };
const RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/;

async function fnError(error: unknown, fallback: string) {
  try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) return j.error as string; } catch { /* 무시 */ }
  return fallback;
}

export default function StaffManager({ staff, me }: { staff: StaffRow[]; me: { id: string; role: string } }) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pwFor, setPwFor] = useState<string | null>(null);

  const done = (ok: boolean, text: string) => { setMsg({ ok, text }); setBusy(false); if (ok) router.refresh(); };

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    const password = String(fd.get("password") ?? "");
    if (!RULE.test(password)) { setMsg({ ok: false, text: "임시 비밀번호는 10자 이상, 영문 대·소문자와 숫자를 포함해야 합니다." }); return; }
    setBusy(true);
    const { error } = await sb.functions.invoke("staff-admin", { body: { action: "create", email: fd.get("email"), displayName: fd.get("name"), password, role: fd.get("role") } });
    form.reset();
    if (error) return done(false, await fnError(error, "직원을 추가하지 못했습니다."));
    done(true, "직원을 추가했습니다. 임시 비밀번호를 직원에게 따로 전달하고, 첫 로그인 후 '내 계정'에서 바꾸도록 안내하세요.");
  }

  async function setRole(id: string, role: "admin" | "staff") {
    setBusy(true);
    const { error } = await sb.rpc("set_staff_role", { p_user: id, p_role: role });
    done(!error, error ? "권한을 바꾸지 못했습니다." : `${ROLE[role]}로 변경했습니다.`);
  }

  async function transfer(s: StaffRow) {
    if (!confirm(`${s.name}(${s.email})에게 오너 권한을 양도할까요?\n양도 후 본인은 관리자가 되며, 되돌리려면 새 오너가 다시 양도해야 합니다.`)) return;
    setBusy(true);
    const { error } = await sb.rpc("transfer_ownership", { p_new_owner: s.id });
    done(!error, error ? "양도하지 못했습니다." : "오너 권한을 양도했습니다.");
  }

  async function resetPw(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const form = e.currentTarget; const password = String(new FormData(form).get("password") ?? "");
    if (!RULE.test(password)) { setMsg({ ok: false, text: "비밀번호는 10자 이상, 영문 대·소문자와 숫자를 포함해야 합니다." }); return; }
    setBusy(true);
    const { error } = await sb.functions.invoke("staff-admin", { body: { action: "password", userId: id, password } });
    form.reset(); setPwFor(null);
    if (error) return done(false, await fnError(error, "비밀번호를 바꾸지 못했습니다."));
    done(true, "비밀번호를 재설정했습니다. 직원에게 따로 전달해 주세요.");
  }

  async function disable(s: StaffRow) {
    if (!confirm(`${s.name}(${s.email}) 계정을 비활성화할까요?\n로그인이 차단되고 담당 배정도 모두 해제됩니다.`)) return;
    setBusy(true);
    const { error } = await sb.functions.invoke("staff-admin", { body: { action: "disable", userId: s.id } });
    if (error) return done(false, await fnError(error, "비활성화하지 못했습니다."));
    done(true, "비활성화했습니다.");
  }

  return (
    <>
      <section className="card pad mt">
        <h2>직원 추가</h2>
        <form onSubmit={create} className="key-form mt" autoComplete="off">
          <label>이메일<input name="email" type="email" required className="search" autoComplete="off" /></label>
          <label>이름<input name="name" required className="search" maxLength={40} /></label>
          <label>임시 비밀번호<input name="password" type="password" required className="search" autoComplete="new-password" /></label>
          <label>권한<select name="role" defaultValue="staff"><option value="staff">직원</option><option value="admin">관리자</option></select></label>
          <button className="btn primary" disabled={busy}>추가</button>
        </form>
      </section>

      {msg && <div className={`${msg.ok ? "planned" : "notice"} mt`}>{msg.text}</div>}

      <section className="card mt">
        <div className="tbl-wrap"><table className="ops-table">
          <thead><tr><th>직원</th><th>권한</th><th>담당 광고주</th><th></th></tr></thead>
          <tbody>{staff.map((s) => {
            const self = s.id === me.id;
            return (
              <tr key={s.id}>
                <td><div className="cname">{s.name}{self && <span className="faint"> (나)</span>}</div><div className="faint">{s.email}</div></td>
                <td><span className={`badge ${s.role === "owner" ? "acc" : s.role === "admin" ? "good" : ""}`}>{ROLE[s.role]}</span></td>
                <td>{s.clients.length === 0 ? <span className="faint">-</span> : s.clients.map((c) => <span key={c.id} className="chip-s">{c.name}{c.primary ? " (주)" : ""}</span>)}</td>
                <td className="r">
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    {s.role === "staff" && <button className="btn sm" disabled={busy} onClick={() => setRole(s.id, "admin")}>관리자로 지정</button>}
                    {s.role === "admin" && !self && <button className="btn sm" disabled={busy} onClick={() => setRole(s.id, "staff")}>관리자 해제</button>}
                    {me.role === "owner" && s.role !== "owner" && <button className="btn sm" disabled={busy} onClick={() => transfer(s)}>오너 양도</button>}
                    {(s.role !== "owner" || self) && <button className="btn sm" disabled={busy} onClick={() => setPwFor(pwFor === s.id ? null : s.id)}>비밀번호 재설정</button>}
                    {s.role !== "owner" && !self && <button className="btn sm" disabled={busy} onClick={() => disable(s)}>비활성화</button>}
                  </div>
                  {pwFor === s.id && (
                    <form className="row mt-s" style={{ justifyContent: "flex-end" }} onSubmit={(e) => resetPw(e, s.id)} autoComplete="off">
                      <input name="password" type="password" required placeholder="새 비밀번호" className="search" autoComplete="new-password" />
                      <button className="btn sm primary" disabled={busy}>저장</button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>
    </>
  );
}
