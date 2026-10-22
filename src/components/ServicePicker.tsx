"use client";
// 계약 항목 · 온라인 광고 채널 선택 (새 광고주 만들기 / 광고주 설정 공용)
export const SERVICES = [
  { id: "blog", label: "블로그", unit: "건/월", hint: "원고 발행 + 네이버 메인·블로그 탭 순위" },
  { id: "place", label: "플레이스", unit: "키워드", hint: "플레이스 순위 + 캡쳐" },
  { id: "cafe", label: "카페 바이럴", unit: "건/월", hint: "게시 링크 + 캡쳐" },
  { id: "daangn", label: "당근마켓 바이럴", unit: "건/월", hint: "동네생활 게시글" },
  { id: "review", label: "리뷰(지도·영수증)", unit: "건/월", hint: "" },
  { id: "cardnews", label: "SNS 카드뉴스", unit: "회차/월", hint: "인스타그램·카카오 소식·당근 소식" },
  { id: "column", label: "홈페이지 칼럼", unit: "건/월", hint: "" },
  { id: "aeo", label: "AEO", unit: "키워드", hint: "AI 답변형 검색 노출" },
] as const;

export const AD_CHANNEL_OPTIONS = [
  { id: "naver", label: "네이버 광고" },
  { id: "daangn", label: "당근마켓 광고" },
  { id: "kakao", label: "카카오 광고" },
] as const;

export type ServiceState = Record<string, { on: boolean; target: string }>;
export type ChannelState = Record<string, boolean>;

export function ServicePicker({ value, onChange }: { value: ServiceState; onChange: (v: ServiceState) => void }) {
  return (
    <div className="svc-grid">
      {SERVICES.map((s) => {
        const v = value[s.id] ?? { on: false, target: "" };
        return (
          <label key={s.id} className={`svc ${v.on ? "on" : ""}`}>
            <span className="row">
              <input type="checkbox" checked={v.on} onChange={(e) => onChange({ ...value, [s.id]: { ...v, on: e.target.checked } })} />
              <b>{s.label}</b>
            </span>
            {s.hint && <span className="faint">{s.hint}</span>}
            <span className="row">
              <input type="number" min={0} inputMode="numeric" disabled={!v.on} className="search num-in" value={v.target}
                onChange={(e) => onChange({ ...value, [s.id]: { ...v, target: e.target.value } })} placeholder="수량" />
              <span className="faint">{s.unit}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function ChannelPicker({ value, onChange }: { value: ChannelState; onChange: (v: ChannelState) => void }) {
  return (
    <div className="row">
      {AD_CHANNEL_OPTIONS.map((c) => (
        <label key={c.id} className={`svc inline ${value[c.id] ? "on" : ""}`}>
          <input type="checkbox" checked={!!value[c.id]} onChange={(e) => onChange({ ...value, [c.id]: e.target.checked })} /> <b>{c.label}</b>
        </label>
      ))}
    </div>
  );
}

export function serviceRows(clientId: string, v: ServiceState) {
  return Object.entries(v).filter(([, s]) => s.on).map(([service, s]) => ({
    client_id: clientId, service, monthly_target: s.target === "" ? null : Math.max(0, Math.floor(Number(s.target))), updated_at: new Date().toISOString(),
  }));
}
