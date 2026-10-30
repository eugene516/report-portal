"use client";
// 통계: 기간(월 · 최근 3개월)별 문의 · 전환 · 서비스 · 미계약 사유 + AI 월간 요약
// 기준: 접수일이 기간 안인 문의의 현재 단계
import { useState } from "react";
import { toast, toastError } from "@/components/ui";
import { useIq } from "./ctx";
import { callAi } from "./ai";
import { diffDays, type Inquiry, type MonthlySummary, type Stage } from "./model";

const REACH_MEETING: Stage[] = ["meeting", "proposal", "waiting", "won", "lost"];
const REACH_PROPOSAL: Stage[] = ["proposal", "waiting", "won"];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

function periods(today: string) {
  const out: { v: string; label: string }[] = [];
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const v = d.toISOString().slice(0, 7);
    out.push({ v, label: `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월` });
    if (i === 0) out.push({ v: "recent3", label: "최근 3개월" });
  }
  return out;
}
function range(period: string, today: string) {
  if (period === "recent3") {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 2);
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  const end = new Date(`${period}-01T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  return { from: `${period}-01`, to: end.toISOString().slice(0, 10) };
}
const kstStamp = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

export function StatsView({ summaries, onSummary }: { summaries: MonthlySummary[]; onSummary: (s: MonthlySummary) => void }) {
  const { cards, settings, today } = useIq();
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [busy, setBusy] = useState(false);
  const opts = periods(today);
  const label = opts.find((o) => o.v === period)?.label ?? period;
  const { from, to } = range(period, today);
  const cs = cards.filter((c) => c.received_on >= from && c.received_on <= to);
  const won = cs.filter((c) => c.stage === "won");
  const wonDated = won.filter((c) => c.contract_on);
  const reached = (c: Inquiry, ids: Stage[]) => ids.includes(c.stage);
  const tiles: [string, string][] = [
    ["문의", `${cs.length}건`],
    ["미팅 전환율", pct(cs.filter((c) => reached(c, REACH_MEETING)).length, cs.length)],
    ["계약률", pct(won.length, cs.length)],
    ["평균 문의→계약", wonDated.length ? `${Math.round(wonDated.reduce((a, c) => a + diffDays(c.contract_on!, c.received_on), 0) / wonDated.length)}일` : "-"],
  ];
  const channelNames = [...settings.channels, ...new Set(cs.map((c) => c.channel ?? "미지정").filter((x) => !settings.channels.includes(x)))];
  const serviceNames = [...settings.services, ...new Set(cs.flatMap((c) => c.services).filter((x) => !settings.services.includes(x)))];
  const lost = new Map<string, Inquiry[]>();
  for (const c of cs.filter((x) => x.stage === "lost")) { const k = c.lost_reason || "사유 없음"; lost.set(k, [...(lost.get(k) ?? []), c]); }
  const latest = summaries.find((s) => s.period === period);

  async function makeSummary() {
    setBusy(true);
    const r = await callAi<{ summary: MonthlySummary }>({ action: "monthly", period });
    setBusy(false);
    if (!r.ok) return toastError(r.error);
    onSummary(r.data.summary);
    toast("월간 요약을 만들었습니다.");
  }

  return (
    <section>
      <div className="iq-top">
        <div><h2>통계</h2><p>접수일 기준 {from} ~ {to} · 단계는 지금 상태 기준입니다.</p></div>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="기간">{opts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
      </div>
      <div className="iq-tiles">{tiles.map(([k, v]) => <div key={k} className="iq-tile"><div className="iq-k">{k}</div><div className="iq-v">{v}</div></div>)}</div>

      <div className="iq-sec"><h3>채널별 전환</h3>
        <div className="iq-tw"><table className="iq-table iq-static">
          <thead><tr><th>채널</th><th className="num">문의</th><th className="num">미팅 도달</th><th className="num">제안</th><th className="num">계약</th><th className="num">미계약</th><th className="num">계약률</th></tr></thead>
          <tbody>
            {cs.length === 0 && <tr><td colSpan={7} className="iq-empty">이 기간에 접수된 문의가 없습니다.</td></tr>}
            {channelNames.map((ch) => {
              const a = cs.filter((c) => (c.channel ?? "미지정") === ch);
              if (!a.length) return null;
              const n = (ids: Stage[]) => a.filter((c) => reached(c, ids)).length;
              const w = n(["won"]);
              return <tr key={ch}><td>{ch}</td><td className="num">{a.length}</td><td className="num">{n(REACH_MEETING)}</td><td className="num">{n(REACH_PROPOSAL)}</td><td className="num">{w}</td><td className="num">{n(["lost"])}</td><td className="num"><b>{pct(w, a.length)}</b></td></tr>;
            })}
          </tbody>
        </table></div>
      </div>

      <div className="iq-sec"><h3>서비스별</h3>
        <div className="iq-tw"><table className="iq-table iq-static">
          <thead><tr><th>관심 서비스</th><th className="num">문의</th><th className="num">계약</th></tr></thead>
          <tbody>
            {serviceNames.map((s) => {
              const a = cs.filter((c) => c.services.includes(s));
              if (!a.length) return null;
              return <tr key={s}><td>{s}</td><td className="num">{a.length}</td><td className="num">{a.filter((c) => c.stage === "won").length}</td></tr>;
            })}
            {!cs.some((c) => c.services.length) && <tr><td colSpan={3} className="iq-empty">없음</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="iq-sec"><h3>미계약 사유</h3>
        <div className="iq-tw"><table className="iq-table iq-static">
          <thead><tr><th>사유</th><th className="num">건수</th><th>대표 메모</th></tr></thead>
          <tbody>
            {lost.size === 0 && <tr><td colSpan={3} className="iq-empty">없음</td></tr>}
            {[...lost.entries()].sort((a, b) => b[1].length - a[1].length).map(([r, a]) => (
              <tr key={r}><td>{r}</td><td className="num">{a.length}</td><td className="iq-wrap">{a.find((c) => c.lost_memo)?.lost_memo ?? ""}</td></tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="iq-sec"><h3>AI 월간 요약 <span className="iq-hint">{label} · 집계 숫자만 AI에 보냅니다</span></h3>
        <button className="btn sm iq-ai" onClick={makeSummary} disabled={busy}>{busy ? "만드는 중…" : latest ? "다시 만들기" : `${label} 요약 만들기`}</button>
        {latest && <div className="iq-aiout">{latest.body}<div className="iq-hint iq-mt-xs">{kstStamp(latest.created_at)} 생성</div></div>}
      </div>
    </section>
  );
}
