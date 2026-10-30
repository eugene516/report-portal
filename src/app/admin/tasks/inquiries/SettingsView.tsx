"use client";
// 설정: 문의 채널 · 관심 서비스 · 미계약 사유 · 단계별 기준일 (관리자만 수정, DB 규칙이 다시 확인) + 계정 목록(직원 명단)
import { useState } from "react";
import { useIq } from "./ctx";
import { roleName, STAGES, type Settings } from "./model";

type ListKey = "channels" | "services" | "lost_reasons";

function TagList({ k, title, placeholder }: { k: ListKey; title: string; placeholder: string }) {
  const { settings, isAdmin, saveSettings } = useIq();
  const [v, setV] = useState("");
  const list = settings[k];
  const add = () => {
    const t = v.trim().slice(0, 40);
    if (!t || list.includes(t)) { setV(""); return; }
    saveSettings({ [k]: [...list, t] } as Partial<Settings>); setV("");
  };
  return (
    <div className="iq-sec">
      <h3>{title}</h3>
      <div className="iq-taglist">
        {list.length === 0 && <span className="iq-hint">없음</span>}
        {list.map((x) => (
          <span key={x} className="iq-tag">{x}{isAdmin && <button onClick={() => saveSettings({ [k]: list.filter((y) => y !== x) } as Partial<Settings>)} aria-label={`${x} 삭제`} title="삭제">✕</button>}</span>
        ))}
      </div>
      {isAdmin && (
        <form className="iq-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input value={v} onChange={(e) => setV(e.target.value)} maxLength={40} placeholder={placeholder} />
          <button className="btn sm">추가</button>
        </form>
      )}
    </div>
  );
}

export function SettingsView() {
  const { settings, isAdmin, staff, saveSettings } = useIq();
  return (
    <section>
      <div className="iq-top"><div><h2>설정</h2><p>{isAdmin ? "관리자만 수정할 수 있습니다. 목록에서 지워도 이미 기록된 문의의 값은 그대로 남습니다." : "관리자만 수정할 수 있습니다. (보기 전용)"}</p></div></div>
      <TagList k="channels" title="문의 채널" placeholder="채널 추가" />
      <TagList k="services" title="관심 서비스" placeholder="서비스 추가" />
      <div className="iq-sec">
        <h3>단계별 기준일 <span className="iq-hint">이 일수 동안 아무 기록이 없으면 &apos;놓치고 있는 문의&apos;에 올라옵니다</span></h3>
        {STAGES.filter((s) => s.sla).map((s) => (
          <div key={s.id} className="iq-slarow">
            <span>{s.name}</span>
            <span>
              <input key={`${s.id}-${settings.sla[s.id] ?? ""}`} type="number" min={0} max={365} disabled={!isAdmin} defaultValue={settings.sla[s.id] ?? ""} aria-label={`${s.name} 기준일`}
                onBlur={(e) => {
                  const n = Math.max(0, Math.min(365, Math.floor(Number(e.target.value))));
                  if (e.target.value === "" || Number.isNaN(n) || n === settings.sla[s.id]) return;
                  saveSettings({ sla: { ...settings.sla, [s.id]: n } });
                }} /> 일
            </span>
          </div>
        ))}
      </div>
      <TagList k="lost_reasons" title="미계약 사유 목록" placeholder="사유 추가" />
      <div className="iq-sec">
        <h3>계정</h3>
        <div className="iq-tw"><table className="iq-table iq-static">
          <thead><tr><th>이름</th><th>역할</th><th>이메일</th><th>상태</th></tr></thead>
          <tbody>
            {staff.map((u) => <tr key={u.id}><td>{u.name}{u.job_title && <span className="iq-hint"> {u.job_title}</span>}</td><td>{roleName(u.role)}</td><td>{u.email}</td><td><span className="iq-chip ok">활성</span></td></tr>)}
          </tbody>
        </table></div>
        <p className="iq-hint">직원 계정은 ‘직원 관리’에서 만듭니다. 팀원은 모든 문의를 볼 수 있고, 담당자만 단계 변경 · 계약 처리를 합니다(관리자는 전부).</p>
      </div>
    </section>
  );
}
