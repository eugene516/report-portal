"use client";
// 레포트 상세보기: 엑셀 시트처럼 위쪽 탭으로 항목을 바꿔 본다 (한 페이지 안에서 전환, 주소 #탭 기억)
// PDF 저장: 모든 탭을 탭마다 새 페이지로 나눠 인쇄한다 (globals.css @media print .sheet-pane)
import { useEffect, useState } from "react";

export type Sheet = { id: string; label: string; badge?: string | null; node: React.ReactNode };

export default function SheetTabs({ sheets, title }: { sheets: Sheet[]; title: string }) {
  const [on, setOn] = useState(sheets[0]?.id ?? "");
  // 주소 끝의 #탭 으로 바로 열기 (새로 고쳐도 같은 탭)
  useEffect(() => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h && sheets.some((s) => s.id === h)) setOn(h);   // eslint-disable-line react-hooks/set-state-in-effect
  }, [sheets]);
  const pick = (id: string) => { setOn(id); history.replaceState(null, "", `#${id}`); window.scrollTo({ top: 0 }); };
  const idx = sheets.findIndex((s) => s.id === on);

  return (
    <div className="sheets">
      <div className="sheet-bar">
        <nav className="sheet-tabs" role="tablist" aria-label="레포트 항목">
          {sheets.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === on} className={s.id === on ? "on" : ""} onClick={() => pick(s.id)}>
              {s.label}{s.badge && <span className="sheet-badge">{s.badge}</span>}
            </button>
          ))}
        </nav>
        <button className="btn sm primary sheet-pdf" onClick={() => window.print()} title="모든 탭을 탭마다 새 페이지로 나눠 저장합니다. 인쇄 창에서 'PDF로 저장'을 고르세요.">⤓ PDF로 저장 (전체)</button>
      </div>
      {sheets.map((s) => (
        <section key={s.id} role="tabpanel" className={`sheet-pane ${s.id === on ? "on" : ""}`} aria-label={s.label}>
          <h2 className="sheet-title">{title} · {s.label}</h2>
          {s.node}
        </section>
      ))}
      <div className="sheet-nav row">
        {idx > 0 && <button className="btn sm" onClick={() => pick(sheets[idx - 1].id)}>‹ {sheets[idx - 1].label}</button>}
        <span style={{ flex: 1 }} />
        {idx >= 0 && idx < sheets.length - 1 && <button className="btn sm" onClick={() => pick(sheets[idx + 1].id)}>{sheets[idx + 1].label} ›</button>}
      </div>
    </div>
  );
}
