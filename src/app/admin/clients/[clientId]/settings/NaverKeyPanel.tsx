"use client";
// 네이버 검색광고 API 키 (해당 광고주 담당 직원 · 관리자)
// 입력값은 브라우저 → Supabase naver-key-admin 함수로 직접 전송되고, 전송 직후 화면에서 지운다.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

const kstDay = (offset: number) => new Date(Date.now() + 9 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

export default function NaverKeyPanel({ clientId, current }: { clientId: string; current: { customer_id_last4: string; access_license_last4: string; secret_key_last4: string; is_active: boolean; updated_at: string } | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(!current);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(kstDay(-7));
  const [to, setTo] = useState(kstDay(-1));

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    const body = { action: "upsert", clientId, customerId: fd.get("customerId"), accessLicense: fd.get("accessLicense"), secretKey: fd.get("secretKey") };
    form.reset();
    setBusy(true); setMsg(null);
    const { data, error } = await supabaseBrowser().functions.invoke("naver-key-admin", { body });
    setBusy(false);
    if (error) {
      let text = "저장에 실패했습니다.";
      try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) text = j.error + (j.detail ? ` (${j.detail})` : ""); } catch { /* 무시 */ }
      return setMsg({ ok: false, text });
    }
    setMsg({ ok: true, text: `저장했습니다. 캠페인 ${data.campaignCount}개 확인 · 끝 4자리 ${data.customerIdLast4} / ${data.accessLicenseLast4} / ${data.secretKeyLast4}` });
    setOpen(false); router.refresh();
  }
  async function resync() {
    setBusy(true); setMsg(null);
    // 키워드가 많으면 한 번에 다 못 받는다 → 남은 앞쪽 날짜(entityPending)까지 이어서 다시 요청
    let end = to, rows = 0;
    for (let round = 0; round < 20; round++) {
      const { data, error } = await supabaseBrowser().functions.invoke("naver-sync", { body: { clientId, from, to: end } });
      if (error) { setBusy(false); return setMsg({ ok: false, text: "수집을 시작하지 못했습니다. (이미 실행 중이거나 기간이 잘못되었을 수 있습니다)" }); }
      const r = data?.results?.[0];
      if (r?.status !== "success") { setBusy(false); return setMsg({ ok: false, text: r ? "수집에 실패했습니다. 대시보드의 '확인 필요'를 확인하세요." : "사용 중인 키가 없습니다." }); }
      if (round === 0) rows = r.rows;
      if (!r.entityPending) break;
      end = r.entityPending;
      setMsg({ ok: true, text: `광고비 ${rows}건 저장 · 키워드 성과 이어서 수집 중 (${from} ~ ${end} 남음)` });
    }
    setBusy(false);
    setMsg({ ok: true, text: `수집 완료: ${rows}건 저장 (${from} ~ ${to})` });
    router.refresh();
  }

  return (
    <div className="key-panel mt">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>네이버 검색광고 API 키</h3>
        {current && <span className="faint">CUSTOMER_ID ****{current.customer_id_last4} · 액세스라이선스 ****{current.access_license_last4} · 비밀키 ****{current.secret_key_last4} · {current.is_active ? "사용 중" : "비활성"}</span>}
      </div>
      {current && !open && <button className="btn sm mt-s" onClick={() => setOpen(true)}>새 키로 교체</button>}
      {open && (
        <form onSubmit={save} className="key-form mt-s" autoComplete="off">
          <label>CUSTOMER_ID<input name="customerId" inputMode="numeric" required className="search" autoComplete="off" /></label>
          <label>액세스라이선스<input name="accessLicense" type="password" required className="search" autoComplete="new-password" /></label>
          <label>비밀키<input name="secretKey" type="password" required className="search" autoComplete="new-password" /></label>
          <button className="btn primary" disabled={busy}>{busy ? "확인 중…" : "연결 확인 후 저장"}</button>
        </form>
      )}
      <p className="faint">키는 네이버 API 연결을 확인한 뒤 암호화되어 저장되며, 원문은 누구도 다시 볼 수 없습니다. (검색광고 관리자 → 도구 → API 사용 관리)</p>
      {current && (
        <div className="row mt-s">
          <span className="faint">수동 재수집</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="search date" aria-label="시작일" />
          <span className="faint">~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="search date" aria-label="종료일" />
          <button className="btn sm" type="button" disabled={busy} onClick={resync}>재수집</button>
        </div>
      )}
      {msg && <div className={`${msg.ok ? "planned" : "notice"} mt-s`}>{msg.text}</div>}
    </div>
  );
}
