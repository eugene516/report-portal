"use client";
// 광고주 설정 화면 (모든 변경은 로그인 세션으로 직접 저장 → DB 규칙이 권한을 다시 확인)
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { AD_CHANNEL_OPTIONS, serviceRows, ServicePicker, type ServiceState } from "@/components/ServicePicker";
import { uploadQuotes } from "@/components/quotes";
import IssueLinkButton from "@/app/admin/IssueLinkButton";
import NaverKeyPanel from "./NaverKeyPanel";

type Props = {
  client: { id: string; name: string; category: string | null; area: string | null };
  services: ServiceState;
  channels: Record<string, { contracted: boolean; apiConnected: boolean; budget: number | null }>;
  assigned: { id: string; name: string; primary: boolean }[];
  directory: { id: string; name: string; email: string }[];
  canManageStaff: boolean; isAdmin: boolean;
  quotes: { id: string; storage_path: string; file_name: string; size_bytes: number | null; created_at: string }[];
  tokens: { id: string; label: string | null; created_at: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null }[];
  naverKey: { customer_id_last4: string; access_license_last4: string; secret_key_last4: string; is_active: boolean; updated_at: string } | null;
};

const day = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "-");

export default function ClientSettings(p: Props) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const id = p.client.id;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [services, setServices] = useState<ServiceState>(p.services);
  const done = (ok: boolean, text: string) => { setMsg({ ok, text }); setBusy(false); if (ok) router.refresh(); window.scrollTo({ top: 0, behavior: "smooth" }); };

  async function saveInfo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const fd = new FormData(e.currentTarget); setBusy(true);
    const { error } = await sb.from("clients").update({ name: String(fd.get("name")).trim(), category: String(fd.get("category")).trim() || null, area: String(fd.get("area")).trim() || null, updated_at: new Date().toISOString() }).eq("id", id);
    done(!error, error ? "기본 정보를 저장하지 못했습니다." : "기본 정보를 저장했습니다.");
  }
  async function saveServices() {
    setBusy(true);
    const rows = serviceRows(id, services);
    const off = Object.entries(services).filter(([, s]) => !s.on).map(([k]) => k);
    const r1 = rows.length ? await sb.from("client_services").upsert(rows) : { error: null };
    const r2 = off.length ? await sb.from("client_services").delete().eq("client_id", id).in("service", off) : { error: null };
    done(!r1.error && !r2.error, r1.error || r2.error ? "계약 항목을 저장하지 못했습니다." : "계약 항목을 저장했습니다. 리포트 메뉴에 바로 반영됩니다.");
  }
  async function toggleChannel(ch: string, contracted: boolean) {
    setBusy(true);
    const { error } = await sb.from("client_ad_channels").update({ contracted, updated_at: new Date().toISOString() }).eq("client_id", id).eq("channel", ch);
    done(!error, error ? "광고 채널을 저장하지 못했습니다." : "광고 채널을 저장했습니다.");
  }
  async function saveBudget(ch: string, value: string) {
    const v = value.trim() === "" ? null : Math.max(0, Math.floor(Number(value.replace(/[^\d]/g, ""))));
    setBusy(true);
    const { error } = await sb.from("client_ad_channels").update({ monthly_budget: v, updated_at: new Date().toISOString() }).eq("client_id", id).eq("channel", ch);
    done(!error, error ? "월 예산을 저장하지 못했습니다." : "월 예산을 저장했습니다. 리포트의 광고비 소진율에 반영됩니다.");
  }
  async function addStaff(userId: string) {
    setBusy(true);
    const { error } = await sb.from("client_staff").insert({ client_id: id, user_id: userId, is_primary: false });
    done(!error, error ? "담당자를 추가하지 못했습니다." : "보조 담당을 추가했습니다.");
  }
  async function removeStaff(userId: string) {
    if (!confirm("담당에서 제외할까요? 제외된 직원은 이 광고주를 더 이상 볼 수 없습니다.")) return;
    setBusy(true);
    const { error } = await sb.from("client_staff").delete().eq("client_id", id).eq("user_id", userId);
    done(!error, error ? "담당자를 제외하지 못했습니다." : "담당에서 제외했습니다.");
  }
  async function makePrimary(userId: string) {
    setBusy(true);
    const cur = p.assigned.find((a) => a.primary);
    const r1 = cur ? await sb.from("client_staff").update({ is_primary: false }).eq("client_id", id).eq("user_id", cur.id) : { error: null };
    const r2 = await sb.from("client_staff").update({ is_primary: true }).eq("client_id", id).eq("user_id", userId);
    done(!r1.error && !r2.error, r1.error || r2.error ? "주담당을 바꾸지 못했습니다." : "주담당을 바꿨습니다.");
  }
  async function addQuotes(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    const r = await uploadQuotes(sb, id, files);
    done(r.failed === 0, r.failed ? `견적서 ${r.failed}개를 올리지 못했습니다 (형식·크기 확인).` : "견적서를 올렸습니다.");
  }
  async function openQuote(path: string) {
    const { data } = await sb.storage.from("quotes").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }
  async function revoke(tokenId: string) {
    if (!confirm("이 광고주 링크를 폐기할까요? 폐기한 링크로는 더 이상 접속할 수 없습니다.")) return;
    setBusy(true);
    const { error } = await sb.from("client_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenId);
    done(!error, error ? "링크를 폐기하지 못했습니다." : "링크를 폐기했습니다.");
  }

  const candidates = p.directory.filter((d) => !p.assigned.some((a) => a.id === d.id));

  return (
    <>
      {msg && <div className={`${msg.ok ? "planned" : "notice"} mt`}>{msg.text}</div>}

      <section className="card pad mt">
        <h2>기본 정보</h2>
        <form onSubmit={saveInfo} className="key-form mt">
          <label>광고주 이름<input name="name" defaultValue={p.client.name} required maxLength={60} className="search" /></label>
          <label>업종<input name="category" defaultValue={p.client.category ?? ""} maxLength={40} className="search" /></label>
          <label>지역<input name="area" defaultValue={p.client.area ?? ""} maxLength={60} className="search" /></label>
          <button className="btn" disabled={busy}>저장</button>
        </form>
      </section>

      <section className="card pad mt">
        <div className="card-h"><h2>계약 항목</h2><button className="btn primary sm" disabled={busy} onClick={saveServices}>계약 항목 저장</button></div>
        <ServicePicker value={services} onChange={setServices} />
      </section>

      <section className="card pad mt">
        <h2>온라인 광고</h2>
        <div className="tbl-wrap mt"><table>
          <thead><tr><th>채널</th><th>계약</th><th>월 예산 (VAT 포함)</th><th>API 연결</th></tr></thead>
          <tbody>{AD_CHANNEL_OPTIONS.map((c) => {
            const s = p.channels[c.id] ?? { contracted: false, apiConnected: false, budget: null };
            return (
              <tr key={c.id}>
                <td><b>{c.label}</b></td>
                <td><label className="row"><input type="checkbox" checked={s.contracted} disabled={busy} onChange={(e) => toggleChannel(c.id, e.target.checked)} /> {s.contracted ? "계약" : "미계약 (리포트에 '집행되지 않는 광고' 안내)"}</label></td>
                <td>{s.contracted ? (
                  <form className="row" onSubmit={(e) => { e.preventDefault(); saveBudget(c.id, String(new FormData(e.currentTarget).get("budget") ?? "")); }}>
                    <input name="budget" inputMode="numeric" defaultValue={s.budget ?? ""} placeholder="예: 300000" className="search num-in wide" />
                    <span className="faint">원</span><button className="btn sm" disabled={busy}>저장</button>
                  </form>) : <span className="faint">-</span>}</td>
                <td>{s.apiConnected ? <span className="badge good">연결됨</span> : c.id === "naver" ? <span className="badge warn">아래에서 키 등록</span> : <span className="faint">준비 중</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <NaverKeyPanel clientId={id} current={p.naverKey} />
      </section>

      <section className="card pad mt">
        <h2>담당 직원</h2>
        <ul className="list">
          {p.assigned.map((a) => (
            <li key={a.id}>
              <span><b>{a.name}</b> {a.primary ? <span className="badge acc">주담당</span> : <span className="badge">보조</span>}</span>
              {p.canManageStaff && !a.primary && (
                <span className="row">
                  <button className="btn sm" disabled={busy} onClick={() => makePrimary(a.id)}>주담당으로</button>
                  <button className="btn sm" disabled={busy} onClick={() => removeStaff(a.id)}>제외</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {p.canManageStaff ? (
          candidates.length > 0 && (
            <div className="row mt">
              <select id="add-staff" defaultValue="">
                <option value="" disabled>보조 담당 추가…</option>
                {candidates.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.email})</option>)}
              </select>
              <button className="btn sm" disabled={busy} onClick={() => { const v = (document.getElementById("add-staff") as HTMLSelectElement).value; if (v) addStaff(v); }}>추가</button>
            </div>
          )
        ) : <p className="faint">담당자 변경은 주담당 또는 관리자만 할 수 있습니다.</p>}
      </section>

      <section className="card pad mt">
        <h2>견적서</h2>
        <ul className="list">
          {p.quotes.length === 0 && <li className="faint">첨부된 견적서가 없습니다.</li>}
          {p.quotes.map((q) => (
            <li key={q.id}><span>{q.file_name} <span className="faint">{day(q.created_at)}</span></span><button className="btn sm" onClick={() => openQuote(q.storage_path)}>열기</button></li>
          ))}
        </ul>
        <div className="row mt"><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.hwp" disabled={busy} onChange={(e) => addQuotes([...(e.target.files ?? [])])} /></div>
      </section>

      <section className="card pad mt">
        <div className="card-h"><h2>광고주 링크</h2><IssueLinkButton clientId={id} /></div>
        <p className="faint">광고주에게 보내는 전용 주소입니다. 링크는 발급할 때 한 번만 보이며, 잃어버리면 새로 발급하고 기존 링크는 폐기하세요.</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>발급</th><th>최근 접속</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {p.tokens.length === 0 && <tr><td colSpan={4} className="faint">발급된 링크가 없습니다.</td></tr>}
            {p.tokens.map((t) => {
              const expired = t.expires_at && new Date(t.expires_at) < new Date();
              return (
                <tr key={t.id}>
                  <td className="num">{day(t.created_at)}</td><td className="num faint">{day(t.last_used_at)}</td>
                  <td>{t.revoked_at ? <span className="badge">폐기됨</span> : expired ? <span className="badge">만료</span> : <span className="badge good">사용 중</span>}</td>
                  <td className="r">{!t.revoked_at && <button className="btn sm" disabled={busy} onClick={() => revoke(t.id)}>폐기</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
