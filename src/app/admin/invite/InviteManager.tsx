"use client";
// 직원 초대 화면
// - 계정 생성·임시 비밀번호 발급·메일 발송은 Supabase staff-admin 함수가 처리 (임시 비밀번호는 서버에서 만들고 저장하지 않음)
// - 초대 링크와 임시 비밀번호를 이 화면에 한 번 보여준다 → 관리자가 복사해 직원에게 직접 전달
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { StaffRow } from "@/lib/dashboard";
import { NEW_JOB_TITLES } from "@/lib/titles";

const ROLE: Record<string, string> = { owner: "오너", admin: "관리자", staff: "직원" };
const kst = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "-");

type Issued = { email: string; mailed: boolean; loginUrl: string; tempPassword?: string };

async function fnError(error: unknown, fallback: string) {
  try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) return j.error as string; } catch { /* 무시 */ }
  return fallback;
}

function status(s: StaffRow) {
  if (s.mustChange && !s.lastSignIn) return <span className="badge warn">초대됨 · 로그인 전</span>;
  if (s.mustChange) return <span className="badge warn">비밀번호 변경 전</span>;
  return <span className="badge good">사용 중</span>;
}

export default function InviteManager({ staff, meId }: { staff: StaffRow[]; meId: string }) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);

  function show(email: string, data: { mailed: boolean; loginUrl: string; tempPassword?: string }) {
    setCopied(false);
    setIssued({ email, ...data });
    setMsg({ ok: true, text: `${email} 계정을 만들었습니다. 아래 초대 내용을 복사해 직원에게 전달해 주세요.${data.mailed ? " (초대 메일도 발송했습니다)" : ""}` });
    router.refresh();
  }

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    setBusy(true); setMsg(null); setIssued(null);
    const { data, error } = await sb.functions.invoke("staff-admin", { body: { action: "invite", email, displayName: fd.get("name"), role: fd.get("role") } });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: await fnError(error, "초대하지 못했습니다.") }); return; }
    // 직급 · 담당 업무 저장 (오너·관리자만 가능 — 이 화면이 관리자 전용)
    const title = String(fd.get("title") ?? ""), duty = String(fd.get("duty") ?? "");
    if (data?.userId && (title || duty)) await sb.rpc("set_staff_profile", { p_user: data.userId, p_name: "", p_title: title, p_duty: duty });
    form.reset();
    show(email, data);
  }

  async function reinvite(s: StaffRow) {
    if (!confirm(`${s.name}(${s.email})의 임시 비밀번호를 다시 발급할까요?\n새 임시 비밀번호가 발급되고, 지금 쓰는 비밀번호로는 더 이상 로그인할 수 없습니다.`)) return;
    setBusy(true); setMsg(null); setIssued(null);
    const { data, error } = await sb.functions.invoke("staff-admin", { body: { action: "reinvite", userId: s.id } });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: await fnError(error, "임시 비밀번호를 다시 발급하지 못했습니다.") }); return; }
    show(s.email, data);
  }

  async function copy() {
    if (!issued?.tempPassword) return;
    const text = `[믿는구석] 리포트 포털 초대\n\n초대 링크: ${issued.loginUrl}\n아이디: ${issued.email}\n임시 비밀번호: ${issued.tempPassword}\n\n첫 로그인 후 '내 정보 수정'에서 비밀번호를 바꿔 주세요.`;
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <>
      <section className="card pad mt">
        <h2>새 직원 초대</h2>
        <form onSubmit={invite} className="key-form mt" autoComplete="off">
          <label>이름<input name="name" required maxLength={40} className="search" /></label>
          <label>직급<select name="title" defaultValue="사원">{NEW_JOB_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label>이메일<input name="email" type="email" required className="search" autoComplete="off" placeholder="name@believe-corner.com" /></label>
          <label>담당 업무<input name="duty" maxLength={100} className="search" placeholder="예: 블로그·카페 운영" /></label>
          <label>권한<select name="role" defaultValue="staff"><option value="staff">직원 (담당 광고주만)</option><option value="admin">관리자 (전체)</option></select></label>
          <button className="btn primary" disabled={busy}>{busy ? "처리 중…" : "초대 보내기"}</button>
        </form>
      </section>

      {msg && <div className={`${msg.ok ? "planned" : "notice"} mt`}>{msg.text}</div>}

      {issued?.tempPassword && (
        <section className="card pad mt invite-box">
          <h2>초대 내용 (이 화면을 벗어나면 임시 비밀번호를 다시 볼 수 없습니다)</h2>
          <table><tbody>
            <tr><td className="faint">초대 링크</td><td><code>{issued.loginUrl}</code></td></tr>
            <tr><td className="faint">아이디</td><td><code>{issued.email}</code></td></tr>
            <tr><td className="faint">임시 비밀번호</td><td><code className="big">{issued.tempPassword}</code></td></tr>
          </tbody></table>
          <div className="row mt">
            <button className="btn primary sm" onClick={copy}>{copied ? "복사했습니다" : "초대 내용 복사"}</button>
            <button className="btn sm" onClick={() => setIssued(null)}>닫기</button>
          </div>
          <p className="faint mt-s">메신저 등으로 본인에게만 전달하세요. 초대 링크를 열면 이메일이 미리 입력되어 있고, 임시 비밀번호로 바로 로그인됩니다. 첫 로그인 후 비밀번호를 바꿔야 다른 화면을 쓸 수 있습니다. 임시 비밀번호를 잃어버리면 목록에서 “임시 비밀번호 재발급”을 누르세요.</p>
        </section>
      )}

      <section className="card mt">
        <div className="card-h pad-h"><h2>직원 목록</h2></div>
        <div className="tbl-wrap"><table className="ops-table">
          <thead><tr><th>직원</th><th>권한</th><th>상태</th><th>초대</th><th>최근 로그인</th><th></th></tr></thead>
          <tbody>{staff.map((s) => (
            <tr key={s.id}>
              <td><div className="cname">{s.name}{s.jobTitle && <span className="badge acc">{s.jobTitle}</span>}{s.id === meId && <span className="faint"> (나)</span>}</div><div className="faint">{s.email}</div></td>
              <td><span className={`badge ${s.role === "owner" ? "acc" : s.role === "admin" ? "good" : ""}`}>{ROLE[s.role]}</span></td>
              <td>{status(s)}</td>
              <td className="num faint">{s.invitedAt ? kst(s.invitedAt) : "-"}</td>
              <td className="num faint">{kst(s.lastSignIn)}</td>
              <td className="r">{s.role !== "owner" && s.id !== meId && <button className="btn sm" disabled={busy} onClick={() => reinvite(s)}>임시 비밀번호 재발급</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}
