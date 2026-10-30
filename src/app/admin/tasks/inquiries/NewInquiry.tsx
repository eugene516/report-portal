"use client";
// 새 문의: 원문(홈페이지 문의 메일 · 카톡 대화 · 명함 메모)을 붙여넣고 'AI로 항목 채우기' → 확인 · 수정 후 문의 단계에 등록
import { useState } from "react";
import { toast, toastError } from "@/components/ui";
import { useIq } from "./ctx";
import { callAi } from "./ai";

type Form = { company: string; person: string; phone: string; email: string; channel: string; referrer: string; budget: string; owner: string; industry: string; region: string; summary: string; services: string[] };

export default function NewInquiry({ onClose, onCreated }: { onClose: () => void; onCreated: (c: { id: string }) => void }) {
  const { settings, staff, meId, createCard } = useIq();
  const [raw, setRaw] = useState("");
  const [f, setF] = useState<Form>({ company: "", person: "", phone: "", email: "", channel: settings.channels[0] ?? "", referrer: "", budget: "", owner: meId, industry: "", region: "", summary: "", services: [] });
  const [busy, setBusy] = useState<"parse" | "save" | null>(null);
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function parse() {
    if (!raw.trim()) return toastError("원문을 먼저 붙여넣으세요.");
    setBusy("parse");
    const r = await callAi<{ fields: Partial<Record<keyof Form, unknown>> }>({ action: "parse", raw });
    setBusy(null);
    if (!r.ok) return toastError(r.error);
    const o = r.data.fields ?? {};
    setF((x) => {
      const n = { ...x };
      for (const k of ["company", "person", "phone", "email", "referrer", "budget", "industry", "region", "summary"] as const) {
        const v = typeof o[k] === "string" ? (o[k] as string).trim() : "";
        if (v) n[k] = v;
      }
      if (typeof o.channel === "string" && settings.channels.includes(o.channel)) n.channel = o.channel;
      if (Array.isArray(o.services)) n.services = settings.services.filter((s) => (o.services as unknown[]).includes(s));
      return n;
    });
    toast("항목을 채웠습니다. 확인 후 등록하세요.");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const company = f.company.trim();
    if (!company) return toastError("회사명은 필요합니다.");
    setBusy("save");
    const nul = (s: string) => s.trim() || null;
    const c = await createCard({
      company, person: nul(f.person), phone: nul(f.phone), email: nul(f.email), channel: nul(f.channel), referrer: nul(f.referrer),
      services: f.services, budget: nul(f.budget), industry: nul(f.industry), region: nul(f.region), summary: nul(f.summary),
      raw: nul(raw), owner: f.owner || null,
    });
    setBusy(null);
    if (c) onCreated(c);
  }

  const input = (k: keyof Form, label: string, req = false) => (
    <div className="iq-fld"><label>{label}{req && " *"}</label><input value={f[k] as string} onChange={(e) => set(k, e.target.value)} maxLength={k === "company" ? 100 : 200} required={req} /></div>
  );

  return (
    <div className="iq-modal" role="dialog" aria-modal="true" aria-label="새 문의">
      <div className="iq-modal-bg" onClick={onClose} />
      <form className="iq-mb" onSubmit={save}>
        <div className="iq-mh"><h2>새 문의</h2><button type="button" className="btn sm" onClick={onClose}>닫기</button></div>
        <div className="iq-split">
          <div>
            <div className="iq-fld"><label>문의 원문 붙여넣기</label>
              <textarea className="iq-tall" value={raw} onChange={(e) => setRaw(e.target.value)} maxLength={20000} placeholder="홈페이지 문의 메일, 카톡 대화, 명함 뒷면 메모 등을 그대로 붙여넣으세요." />
            </div>
            <div className="iq-row iq-mt-xs">
              <button type="button" className="btn sm iq-ai" onClick={parse} disabled={busy !== null}>{busy === "parse" ? "읽는 중…" : "AI로 항목 채우기"}</button>
              <span className="iq-hint">오른쪽 항목이 자동으로 채워집니다. 확인 후 수정하세요.</span>
            </div>
          </div>
          <div className="iq-grid2">
            {input("company", "회사 · 병원명", true)}
            {input("person", "담당자 · 직책")}
            {input("phone", "연락처")}
            {input("email", "이메일")}
            <div className="iq-fld"><label>채널 *</label>
              <select value={f.channel} onChange={(e) => set("channel", e.target.value)}>
                {settings.channels.length === 0 && <option value="">(설정에서 채널 추가)</option>}
                {settings.channels.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {input("referrer", "소개자")}
            {input("budget", "예산")}
            <div className="iq-fld"><label>담당자(우리)</label>
              <select value={f.owner} onChange={(e) => set("owner", e.target.value)}>
                <option value="">미정</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {input("industry", "업종")}
            {input("region", "지역")}
            <div className="iq-fld iq-w"><label>관심 서비스</label>
              <div className="iq-taglist">
                {settings.services.map((s) => (
                  <label key={s} className="iq-tag iq-check">
                    <input type="checkbox" checked={f.services.includes(s)} onChange={(e) => setF((x) => ({ ...x, services: e.target.checked ? [...x.services, s] : x.services.filter((y) => y !== s) }))} />{s}
                  </label>
                ))}
              </div>
            </div>
            <div className="iq-fld iq-w"><label>요청 내용 요약</label><textarea value={f.summary} onChange={(e) => set("summary", e.target.value)} maxLength={4000} /></div>
          </div>
        </div>
        <div className="iq-row iq-end">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" disabled={busy !== null}>{busy === "save" ? "등록 중…" : "문의 단계에 등록"}</button>
        </div>
      </form>
    </div>
  );
}
