"use client";
// 직원 관리 화면
// - 비밀번호 재설정·비활성화 (새 직원 초대는 /admin/invite): Supabase staff-admin 함수로 직접 전송 (웹 서버를 거치지 않음)
// - 관리자 지정·해제, 오너 양도: DB 함수(set_staff_role / transfer_ownership)가 권한을 다시 확인
// - 이름 · 직급 · 담당 업무: set_staff_profile (오너·관리자만, 업무 확인 보드 멤버에도 함께 반영)
import { ask } from "@/components/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { StaffRow } from "@/lib/dashboard";
import { JOB_TITLES } from "@/lib/titles";

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
  const [editFor, setEditFor] = useState<string | null>(null);

  const done = (ok: boolean, text: string) => { setMsg({ ok, text }); setBusy(false); if (ok) router.refresh(); };

  async function setRole(id: string, role: "admin" | "staff") {
    setBusy(true);
    const { error } = await sb.rpc("set_staff_role", { p_user: id, p_role: role });
    done(!error, error ? "권한을 바꾸지 못했습니다." : `${ROLE[role]}로 변경했습니다.`);
  }

  async function transfer(s: StaffRow) {
    if (!await ask(`${s.name}(${s.email})에게 오너 권한을 양도할까요?\n양도 후 본인은 관리자가 되며, 되돌리려면 새 오너가 다시 양도해야 합니다.`)) return;
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

  async function saveProfile(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await sb.rpc("set_staff_profile", { p_user: id, p_name: String(fd.get("name") ?? ""), p_title: String(fd.get("title") ?? ""), p_duty: String(fd.get("duty") ?? "") });
    if (!error) setEditFor(null);
    done(!error, error ? "직원 정보를 저장하지 못했습니다." : "직원 정보를 저장했습니다.");
  }

  async function disable(s: StaffRow) {
    if (!await ask(`${s.name}(${s.email}) 계정을 비활성화할까요?\n로그인이 차단되고 담당 배정도 모두 해제됩니다.`)) return;
    setBusy(true);
    const { error } = await sb.functions.invoke("staff-admin", { body: { action: "disable", userId: s.id } });
    if (error) return done(false, await fnError(error, "비활성화하지 못했습니다."));
    done(true, "비활성화했습니다.");
  }

  return (
    <>
      <div className="row mt"><Link href="/admin/invite" className="btn primary">+ 직원 초대</Link><span className="faint">새 직원은 초대 메뉴에서 이메일로 초대합니다.</span></div>

      {msg && <div className={`${msg.ok ? "planned" : "notice"} mt`}>{msg.text}</div>}

      <section className="card mt">
        <div className="tbl-wrap"><table className="ops-table rtable">
          <thead><tr><th>직원</th><th>직급 · 담당 업무</th><th>권한</th><th>담당 광고주</th><th></th></tr></thead>
          <tbody>{staff.map((s) => {
            const self = s.id === me.id;
            return (
              <tr key={s.id}>
                <td><div className="cname">{s.name}{self && <span className="faint"> (나)</span>}</div><div className="faint">{s.email}</div></td>
                <td className="wrap-cell" data-label="직급 · 담당 업무">
                  {editFor === s.id ? (
                    <form className="profile-edit" onSubmit={(e) => saveProfile(e, s.id)}>
                      <input name="name" defaultValue={s.name} maxLength={40} className="search" aria-label="이름" />
                      <select name="title" defaultValue={s.jobTitle ?? ""} aria-label="직급"><option value="">직급 없음</option>{JOB_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                      <input name="duty" defaultValue={s.duty ?? ""} maxLength={100} className="search" placeholder="담당 업무 (예: 블로그·카페 운영)" aria-label="담당 업무" />
                      <span className="row"><button className="btn sm primary" disabled={busy}>저장</button><button type="button" className="btn sm" onClick={() => setEditFor(null)}>취소</button></span>
                    </form>
                  ) : (
                    <span className="row">
                      {s.jobTitle ? <span className="badge acc">{s.jobTitle}</span> : <span className="faint">직급 없음</span>}
                      <span className="faint">{s.duty ?? ""}</span>
                      <button className="btn sm" disabled={busy} onClick={() => setEditFor(s.id)}>수정</button>
                    </span>
                  )}
                </td>
                <td data-label="권한"><span className={`badge ${s.role === "owner" ? "acc" : s.role === "admin" ? "good" : ""}`}>{ROLE[s.role]}</span></td>
                <td data-label="담당 광고주">{s.clients.length === 0 ? <span className="faint">-</span> : s.clients.map((c) => <span key={c.id} className="chip-s">{c.name}{c.primary ? " (주)" : ""}</span>)}</td>
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
