"use client";
// 새 광고주 만들기: 기본 정보 → 견적서 첨부 → 계약 항목 · 광고 채널 → 보조 담당
// 저장은 로그인 세션으로 직접 하며, DB 규칙(can_access_client · 주담당)이 권한을 다시 확인한다.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ChannelPicker, serviceRows, ServicePicker, type ChannelState, type ServiceState } from "@/components/ServicePicker";
import { uploadQuotes } from "@/components/quotes";

export default function NewClientForm({ staff }: { staff: { id: string; name: string; email: string }[] }) {
  const router = useRouter();
  const [services, setServices] = useState<ServiceState>({});
  const [channels, setChannels] = useState<ChannelState>({});
  const [support, setSupport] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (!name) return setError("광고주 이름을 입력해 주세요.");
    if (!Object.values(services).some((s) => s.on) && !Object.values(channels).some(Boolean)) return setError("진행할 마케팅 항목을 하나 이상 선택해 주세요.");
    setBusy(true); setError(null);
    const sb = supabaseBrowser();
    const slug = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: id, error: e1 } = await sb.rpc("create_client", {
      p_slug: slug, p_name: name, p_category: String(fd.get("category") ?? "").trim() || null, p_area: String(fd.get("area") ?? "").trim() || null,
    });
    if (e1 || !id) { setBusy(false); return setError("광고주를 만들지 못했습니다."); }
    const problems: string[] = [];
    const rows = serviceRows(id, services);
    if (rows.length && (await sb.from("client_services").upsert(rows)).error) problems.push("계약 항목");
    for (const [ch, on] of Object.entries(channels)) {
      if (on && (await sb.from("client_ad_channels").update({ contracted: true, updated_at: new Date().toISOString() }).eq("client_id", id).eq("channel", ch)).error) problems.push("광고 채널");
    }
    if (support.length && (await sb.from("client_staff").insert(support.map((u) => ({ client_id: id, user_id: u, is_primary: false })))).error) problems.push("보조 담당");
    if (files.length) { const r = await uploadQuotes(sb, id, files); if (r.failed) problems.push(`견적서 ${r.failed}개`); }
    router.push(`/admin/clients/${id}/settings?created=1${problems.length ? `&warn=${encodeURIComponent(problems.join(", "))}` : ""}`);
  }

  return (
    <form onSubmit={submit} className="mt">
      <section className="card pad">
        <h2>1. 기본 정보</h2>
        <div className="key-form mt">
          <label>광고주 이름 *<input name="name" required maxLength={60} className="search" /></label>
          <label>업종<input name="category" maxLength={40} className="search" placeholder="예: 안과" /></label>
          <label>지역<input name="area" maxLength={60} className="search" placeholder="예: 청량리 · 동대문구" /></label>
        </div>
      </section>

      <section className="card pad mt">
        <h2>2. 견적서 첨부</h2>
        <p className="faint">PDF · 이미지 · 엑셀 · 워드 · 한글 파일 (20MB 이하). 비공개 저장소에 보관되며 담당자와 관리자만 볼 수 있습니다.</p>
        <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.hwp" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        {files.length > 0 && <ul className="list">{files.map((f) => <li key={f.name}><span>{f.name}</span><span className="faint">{Math.ceil(f.size / 1024)}KB</span></li>)}</ul>}
      </section>

      <section className="card pad mt">
        <h2>3. 계약 항목 (견적서 기준)</h2>
        <p className="faint">진행하기로 한 마케팅 항목과 월 수량을 선택하세요. 나중에 광고주 설정에서 바꿀 수 있습니다.</p>
        <ServicePicker value={services} onChange={setServices} />
        <h3 className="mt-l">온라인 광고</h3>
        <ChannelPicker value={channels} onChange={setChannels} />
        <p className="faint">계약하지 않은 광고 채널은 리포트에 &quot;집행되지 않는 광고&quot;로 표시됩니다. API 키는 만든 뒤 광고주 설정에서 등록합니다.</p>
      </section>

      <section className="card pad mt">
        <h2>4. 보조 담당 (선택)</h2>
        {staff.length === 0 ? <p className="faint">추가할 수 있는 다른 직원이 없습니다.</p> : (
          <div className="row">{staff.map((s) => (
            <label key={s.id} className={`svc inline ${support.includes(s.id) ? "on" : ""}`}>
              <input type="checkbox" checked={support.includes(s.id)} onChange={(e) => setSupport(e.target.checked ? [...support, s.id] : support.filter((x) => x !== s.id))} /> {s.name}
            </label>
          ))}</div>
        )}
      </section>

      {error && <div className="notice mt">{error}</div>}
      <div className="row mt"><button className="btn primary" disabled={busy}>{busy ? "만드는 중…" : "광고주 만들기"}</button></div>
    </form>
  );
}
