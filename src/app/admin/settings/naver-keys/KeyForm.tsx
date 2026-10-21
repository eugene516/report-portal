"use client";
// 키 입력 폼: 브라우저 → Supabase 수집 작업(naver-key-admin)으로 직접 전송 (웹 서버를 거치지 않음)
// - 입력값은 전송 직후 화면 상태에서 지운다. 브라우저 저장소·로그에 남기지 않는다.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

const kstDay = (offset: number) => new Date(Date.now() + 9 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

export default function KeyForm({ clients }: { clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(kstDay(-7));
  const [to, setTo] = useState(kstDay(-1));

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const body = { action: "upsert", clientId, customerId: fd.get("customerId"), accessLicense: fd.get("accessLicense"), secretKey: fd.get("secretKey") };
    form.reset(); // 입력값을 즉시 지운다
    setBusy(true); setMsg(null);
    const { data, error } = await supabaseBrowser().functions.invoke("naver-key-admin", { body });
    setBusy(false);
    if (error) {
      let text = "저장에 실패했습니다.";
      try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) text = j.error + (j.detail ? ` (${j.detail})` : ""); } catch { /* 무시 */ }
      setMsg({ type: "err", text });
      return;
    }
    setMsg({ type: "ok", text: `저장했습니다. 캠페인 ${data.campaignCount}개 확인 · 끝 4자리 ${data.customerIdLast4} / ${data.accessLicenseLast4} / ${data.secretKeyLast4}` });
    router.refresh();
  }

  async function resync() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabaseBrowser().functions.invoke("naver-sync", { body: { clientId, from, to } });
    setBusy(false);
    if (error) { setMsg({ type: "err", text: "수동 수집을 시작하지 못했습니다. (이미 실행 중이거나 기간이 잘못되었을 수 있습니다)" }); return; }
    const r = data?.results?.[0];
    setMsg(r ? { type: r.status === "success" ? "ok" : "err", text: r.status === "success" ? `수집 완료: ${r.rows}건 저장 (${from} ~ ${to})` : "수집에 실패했습니다. 대시보드의 '확인 필요'를 확인하세요." } : { type: "err", text: "이 광고주는 사용 중인 키가 없습니다." });
    router.refresh();
  }

  return (
    <>
      <div className="row mt">
        <label className="faint" htmlFor="client">광고주</label>
        <select id="client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <form onSubmit={save} className="key-form mt" autoComplete="off">
        <label>CUSTOMER_ID<input name="customerId" inputMode="numeric" required className="search" autoComplete="off" /></label>
        <label>액세스라이선스<input name="accessLicense" type="password" required className="search" autoComplete="new-password" /></label>
        <label>비밀키<input name="secretKey" type="password" required className="search" autoComplete="new-password" /></label>
        <button className="btn primary" disabled={busy}>{busy ? "확인 중…" : "연결 확인 후 저장 (덮어쓰기)"}</button>
      </form>
      <div className="row mt-l">
        <span className="faint">수동 재수집</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="search date" aria-label="시작일" />
        <span className="faint">~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="search date" aria-label="종료일" />
        <button className="btn" disabled={busy} onClick={resync} type="button">선택 광고주 재수집</button>
      </div>
      {msg && <div className={msg.type === "ok" ? "planned mt" : "notice mt"}>{msg.text}</div>}
    </>
  );
}
