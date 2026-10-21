// 네이버 광고 성과 (서버 컴포넌트, DB 데이터만 사용)
import Link from "next/link";
import type { NaverReport, Period } from "@/lib/report";

const fmt = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(Number(n)) ? "-" : Number(n).toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });

const kstTime = (iso: string | null) => {
  if (!iso) return "수집 이력 없음";
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} (한국시간)`;
};

export default function NaverAdsView({ data, period, path }: { data: NaverReport; period: Period; path: string }) {
  const k = data.kpi;
  const kpis: [string, string, string][] = [
    ["비용", fmt(k.cost), "원"], ["노출", fmt(k.impressions), "회"], ["클릭", fmt(k.clicks), "회"],
    ["CTR", fmt(k.ctr, 2), "%"], ["CPC", fmt(k.cpc), "원"], ["전환수", fmt(k.conversions), "건"], ["ROAS", fmt(k.roas, 1), "%"],
  ];
  const presets: [Period["key"], string][] = [["yesterday", "어제"], ["7d", "최근 7일"], ["30d", "최근 30일"]];
  return (
    <>
      <div className="row period-bar">
        <div className="seg">
          {presets.map(([key, label]) => (
            <Link key={key} href={`${path}?range=${key}`} className={period.key === key ? "on" : ""}>{label}</Link>
          ))}
        </div>
        <form className="row" action={path} method="get">
          <input type="hidden" name="range" value="custom" />
          <input type="date" name="from" defaultValue={period.from} className="search date" aria-label="시작일" />
          <span className="faint">~</span>
          <input type="date" name="to" defaultValue={period.to} className="search date" aria-label="종료일" />
          <button className="btn sm">직접 선택</button>
        </form>
        <span className="live"><i />마지막 수집 {kstTime(data.lastCollectedAt)}</span>
      </div>
      <p className="faint">기간: {data.from} ~ {data.to} · 비용은 네이버 기준 VAT 포함 금액 · 매일 오전 9시 자동 수집</p>

      <div className="grid g-kpi7 mt">
        {kpis.map(([label, value, unit]) => (
          <div key={label} className="card kpi static"><div className="label">{label}</div><div className="value num">{value}<small>{unit}</small></div></div>
        ))}
      </div>

      <div className="card pad mt">
        <div className="card-h"><h2>일별 추이</h2><span className="faint">막대 비용 · 선 클릭</span></div>
        <DailyChart daily={data.daily} />
      </div>

      <div className="card mt tbl-wrap">
        <table>
          <thead><tr><th>캠페인</th><th className="r">비용</th><th className="r">노출</th><th className="r">클릭</th><th className="r">CTR</th><th className="r">CPC</th><th className="r">평균순위</th><th className="r">전환</th><th className="r">ROAS</th></tr></thead>
          <tbody>
            {data.campaigns.length === 0 && <tr><td colSpan={9} className="faint">이 기간의 캠페인 성과가 없습니다.</td></tr>}
            {data.campaigns.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b></td>
                <td className="r num">{fmt(c.cost)}원</td><td className="r num">{fmt(c.impressions)}</td><td className="r num">{fmt(c.clicks)}</td>
                <td className="r num">{fmt(c.ctr, 2)}%</td><td className="r num">{fmt(c.cpc)}원</td><td className="r num">{fmt(c.avgRank, 1)}</td>
                <td className="r num">{fmt(c.conversions)}</td><td className="r num">{fmt(c.roas, 1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// 서버에서 그리는 SVG 차트 (클라이언트 스크립트 없음)
function DailyChart({ daily }: { daily: NaverReport["daily"] }) {
  if (daily.length === 0) return <div className="empty-state">이 기간의 일별 데이터가 없습니다.</div>;
  const W = 960, H = 240, P = { l: 56, r: 48, t: 12, b: 28 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const maxCost = Math.max(1, ...daily.map((d) => Number(d.cost)));
  const maxClk = Math.max(1, ...daily.map((d) => Number(d.clicks)));
  const bw = iw / daily.length;
  const x = (i: number) => P.l + i * bw + bw / 2;
  const line = daily.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${(P.t + ih - (Number(d.clicks) / maxClk) * ih).toFixed(1)}`).join("");
  const step = Math.ceil(daily.length / 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svg-chart" role="img" aria-label="일별 비용과 클릭 추이">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={P.t + ih * (1 - t)} y2={P.t + ih * (1 - t)} className="grid-line" />
          <text x={P.l - 6} y={P.t + ih * (1 - t) + 4} textAnchor="end" className="axis">{fmt(maxCost * t)}</text>
          <text x={W - P.r + 6} y={P.t + ih * (1 - t) + 4} className="axis">{fmt(maxClk * t)}</text>
        </g>
      ))}
      {daily.map((d, i) => {
        const h = (Number(d.cost) / maxCost) * ih;
        return (
          <g key={d.date}>
            <rect x={x(i) - bw * 0.35} y={P.t + ih - h} width={bw * 0.7} height={h} rx={2} className="bar-1"><title>{`${d.date} 비용 ${fmt(d.cost)}원 · 클릭 ${fmt(d.clicks)}`}</title></rect>
            {i % step === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="axis">{d.date.slice(5).replace("-", "/")}</text>}
          </g>
        );
      })}
      <path d={line} className="line-2" />
    </svg>
  );
}
