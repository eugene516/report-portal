// 네이버 광고 성과 (서버 컴포넌트, DB 데이터만 사용)
// 상단: 기간 선택 · 지표 카드(이전 기간 대비) · 일별 그래프
// 아래: 광고비 소진 현황 · 성과 분석과 개선 제안(자동 + 담당자 코멘트) · 캠페인 · 광고그룹 · 월간 상위 키워드 10(1일~말일) · 요일별
import Link from "next/link";
import { recentMonths, type KeywordWindow, type NaverReport, type Period, type TopKeyword } from "@/lib/report";
import { budgetStatus, buildInsights, DOW, keywordGrade } from "@/lib/naverInsights";
import NoteEditor from "./NoteEditor";

const fmt = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(Number(n)) ? "-" : Number(n).toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const won = (n: number | null | undefined) => (n == null ? "-" : `${fmt(n)}원`);
const kstTime = (iso: string | null | undefined) => {
  if (!iso) return "수집 이력 없음";
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
};

// 이전 기간 대비 변화 (good 방향: 올라가면 좋은 지표인지)
function Delta({ now, prev, upGood = true, unit = "%", digits = 0 }: { now: number | null | undefined; prev: number | null | undefined; upGood?: boolean; unit?: string; digits?: number }) {
  if (now == null || prev == null || Number(prev) === 0) return <span className="faint">이전 기간 비교 없음</span>;
  const ch = ((Number(now) - Number(prev)) / Number(prev)) * 100;
  if (Math.abs(ch) < 0.5) return <span className="delta">이전 기간과 비슷</span>;
  const good = ch > 0 === upGood;
  return <span className={`delta ${good ? "up" : "down"}`}>{ch > 0 ? "▲" : "▼"}{Math.abs(ch).toFixed(0)}{unit} <span className="faint">이전 {fmt(prev, digits)}</span></span>;
}

type TopKw = { window: KeywordWindow; keywords: TopKeyword[]; sort: "clicks" | "impressions" | "cost" };

export default function NaverAdsView({ data, period, path, note, top, query }: {
  data: NaverReport; period: Period; path: string;
  note: { editable: false } | { editable: true; clientId: string; period: string };
  top: TopKw; query: Record<string, string | undefined>;
}) {
  const k = data.kpi, p = data.prev;
  const presets: [Period["key"], string][] = [["yesterday", "어제"], ["7d", "최근 7일"], ["30d", "최근 30일"]];
  const days = data.daily.length || 1;
  const b = budgetStatus(data);
  const insights = buildInsights(data);
  const kpis: { label: string; value: string; unit: string; now: number | null | undefined; prev: number | null | undefined; upGood?: boolean; digits?: number }[] = [
    { label: "광고비", value: fmt(k.cost), unit: "원", now: k.cost, prev: p?.cost, upGood: false },
    { label: "노출", value: fmt(k.impressions), unit: "회", now: k.impressions, prev: p?.impressions },
    { label: "클릭", value: fmt(k.clicks), unit: "회", now: k.clicks, prev: p?.clicks },
    { label: "클릭률(CTR)", value: fmt(k.ctr, 2), unit: "%", now: k.ctr, prev: p?.ctr, digits: 2 },
    { label: "클릭당 비용(CPC)", value: fmt(k.cpc), unit: "원", now: k.cpc, prev: p?.cpc, upGood: false },
    { label: "전환수", value: fmt(k.conversions), unit: "건", now: k.conversions, prev: p?.conversions },
    { label: "ROAS", value: fmt(k.roas, 1), unit: "%", now: k.roas, prev: p?.roas, digits: 1 },
  ];
  const wdMax = Math.max(1, ...data.weekday.map((w) => Number(w.cost)));

  return (
    <>
      <div className="row period-bar">
        <div className="seg">
          {presets.map(([key, label]) => <Link key={key} href={`${path}?range=${key}`} className={period.key === key ? "on" : ""}>{label}</Link>)}
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
      <p className="faint">기간 {data.from} ~ {data.to} ({days}일){p ? ` · 이전 기간(${p.days}일)과 비교` : ""} · 비용은 VAT 포함 · 매일 오전 9시 자동 수집</p>

      <div className="grid g-kpi7 mt">
        {kpis.map((c) => (
          <div key={c.label} className="card kpi static">
            <div className="label">{c.label}</div>
            <div className="value num">{c.value}<small>{c.unit}</small></div>
            <div className="foot"><Delta now={c.now} prev={c.prev} upGood={c.upGood} digits={c.digits} /></div>
          </div>
        ))}
      </div>

      <div className="card pad mt">
        <div className="card-h"><h2>일별 추이</h2><span className="faint">막대 광고비 · 선 클릭</span></div>
        <DailyChart daily={data.daily} />
      </div>

      {/* ── 광고비 소진 현황 ── */}
      <h2 className="mt-l">광고비 소진 현황</h2>
      <div className="grid g-4 mt">
        <div className="card kpi static">
          <div className="label">선택 기간 광고비</div>
          <div className="value num">{fmt(k.cost)}<small>원</small></div>
          <div className="foot">일 평균 {won(Number(k.cost) / days)}</div>
        </div>
        <div className="card kpi static">
          <div className="label">{b?.month ? `${b.month.replace("-", "년 ")}월 누적` : "이번 달 누적"}</div>
          <div className="value num">{fmt(b?.spent)}<small>{b?.budget ? `/ ${fmt(b.budget)}원` : "원"}</small></div>
          {b?.budget ? <><div className={`bar mt-s ${b.spent > b.budget ? "over" : ""}`}><i style={{ width: `${Math.min(100, (b.spent / b.budget) * 100)}%` }} /></div><div className="foot">예산의 {((b.spent / b.budget) * 100).toFixed(0)}% · {b.elapsed}/{b.days}일 경과</div></> : <div className="foot">월 예산 미설정 (광고주 설정에서 입력)</div>}
        </div>
        <div className="card kpi static">
          <div className="label">월말 예상 광고비</div>
          <div className="value num">{fmt(b?.projected)}<small>원</small></div>
          <div className="foot">{b?.budget ? `예산 대비 ${((b.projected / b.budget) * 100).toFixed(0)}% · ` : ""}누적 + 최근 7일 일평균 × 남은 {b ? b.days - b.elapsed : 0}일</div>
        </div>
        <div className={`card kpi static ${b?.daysLeft != null && b.daysLeft < 7 ? "alert" : ""}`}>
          <div className="label">비즈머니 잔액</div>
          <div className="value num">{data.bizmoney?.amount != null ? fmt(data.bizmoney.amount) : "-"}<small>원</small></div>
          <div className="foot">{b?.daysLeft != null ? `최근 일평균 기준 약 ${Math.floor(b.daysLeft)}일분` : "잔액 정보 없음"}{data.bizmoney?.checkedAt ? ` · ${kstTime(data.bizmoney.checkedAt).slice(5)} 확인` : ""}</div>
        </div>
      </div>

      {/* ── 성과 분석 · 개선 제안 ── */}
      <h2 className="mt-l">성과 분석 · 개선 제안</h2>
      <div className="grid g-2 mt">
        <div className="card pad">
          <div className="card-h"><h3>데이터 분석</h3><span className="faint">수집 데이터 기준 자동 분석</span></div>
          {insights.length === 0 ? <p className="faint">특이 사항이 없습니다.</p> : (
            <ul className="insights">
              {insights.map((it, i) => (
                <li key={i} className={`ins ${it.level}`}>
                  <div className="ins-t"><span className={`lv ${it.level === "bad" ? "high" : it.level === "warn" ? "mid" : it.level === "good" ? "ok" : "info"}`} /><b>{it.title}</b></div>
                  <div className="faint">{it.detail}</div>
                  {it.action && <div className="ins-a">→ {it.action}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card pad">
          <div className="card-h"><h3>담당자 운영 코멘트</h3><span className="faint">{data.note?.updatedAt ? `${kstTime(data.note.updatedAt)} 작성` : ""}</span></div>
          {note.editable
            ? <NoteEditor clientId={note.clientId} period={note.period} initial={data.note?.body ?? ""} />
            : data.note?.body ? <div className="note-body">{data.note.body}</div> : <p className="faint">작성된 코멘트가 없습니다.</p>}
        </div>
      </div>

      {/* ── 캠페인 ── */}
      <h2 className="mt-l">캠페인별 성과</h2>
      <PerfTable rows={data.campaigns.map((c) => ({ ...c, key: c.id, sub: "" }))} total={k.cost} />

      {/* ── 광고그룹 ── */}
      {data.adgroups.length > 0 && <>
        <h2 className="mt-l">광고그룹별 성과</h2>
        <PerfTable rows={data.adgroups.map((g) => ({ ...g, key: g.id, sub: g.campaign }))} total={k.cost} />
      </>}

      {/* ── 월간 상위 키워드 10 (1일~말일, 위 기간 선택과 별도) ── */}
      <KeywordTop10 top={top} path={path} query={query} />

      {/* ── 요일별 ── */}
      {data.weekday.length > 0 && <>
        <h2 className="mt-l">요일별 성과</h2>
        <div className="card mt tbl-wrap"><table>
          <thead><tr><th>요일</th><th style={{ width: "30%" }}>광고비</th><th className="r">노출</th><th className="r">클릭</th><th className="r">CTR</th><th className="r">CPC</th></tr></thead>
          <tbody>{data.weekday.map((w) => (
            <tr key={w.dow}>
              <td><b>{DOW[w.dow]}</b> <span className="faint">({w.days}일)</span></td>
              <td><div className="row" style={{ flexWrap: "nowrap" }}><div className="bar" style={{ flex: 1 }}><i style={{ width: `${(Number(w.cost) / wdMax) * 100}%` }} /></div><span className="num nowrap">{won(w.cost)}</span></div></td>
              <td className="r num">{fmt(w.impressions)}</td><td className="r num">{fmt(w.clicks)}</td>
              <td className="r num">{Number(w.impressions) ? `${((Number(w.clicks) / Number(w.impressions)) * 100).toFixed(2)}%` : "-"}</td>
              <td className="r num">{Number(w.clicks) ? won(Number(w.cost) / Number(w.clicks)) : "-"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </>}
    </>
  );
}

const SORTS: [TopKw["sort"], string][] = [["clicks", "클릭순"], ["impressions", "노출순"], ["cost", "광고비순"]];

function KeywordTop10({ top, path, query }: { top: TopKw; path: string; query: Record<string, string | undefined> }) {
  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries({ ...query, ...patch })) if (val) q.set(k, val);
    return `${path}?${q.toString()}#keywords`;
  };
  const rows = [...top.keywords]
    .sort((a, b) => Number(b[top.sort]) - Number(a[top.sort]) || Number(b.impressions) - Number(a.impressions))
    .slice(0, 10);
  const total = top.keywords.reduce((s, x) => s + Number(x[top.sort]), 0) || 1;
  return (
    <>
      <div id="keywords" className="row mt-l" style={{ justifyContent: "space-between" }}>
        <h2>월간 상위 키워드 10</h2>
        <div className="row">
          <form className="row" action={`${path}#keywords`} method="get">
            {Object.entries(query).filter(([k, val]) => val && k !== "kwm").map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
            <select name="kwm" defaultValue={top.window.month} aria-label="집계 월">
              {recentMonths().map((m) => <option key={m} value={m}>{m.replace("-", "년 ")}월</option>)}
            </select>
            <button className="btn sm">보기</button>
          </form>
          <div className="seg">
            {SORTS.map(([k, label]) => <Link key={k} href={href({ kwsort: k })} className={top.sort === k ? "on" : ""} scroll={false}>{label}</Link>)}
          </div>
        </div>
      </div>
      <p className="faint">{top.window.label}{top.window.partial ? ` · 진행 중인 달이라 ${top.window.to.slice(5).replace("-", "/")}까지 집계` : ""} · 이달 노출된 키워드 {top.keywords.length}개 중 {SORTS.find(([k]) => k === top.sort)?.[1]} 상위 10개 · 월말 리포트 기준(1일~말일)</p>
      {rows.length === 0 ? <div className="card pad mt faint">이 달에 노출된 키워드가 없습니다.</div> : (
        <div className="card mt tbl-wrap"><table className="kw-top">
          <thead><tr><th className="r">순위</th><th>키워드 · 광고그룹</th><th className="r">클릭</th><th className="r">노출</th><th className="r">CTR</th><th className="r">광고비</th><th className="r">비중</th><th className="r">CPC</th><th className="r">평균순위</th><th>등급</th></tr></thead>
          <tbody>{rows.map((x, i) => {
            const g = keywordGrade(Number(x.impressions), Number(x.clicks));
            return (
              <tr key={x.id}>
                <td className="r num"><b>{i + 1}</b></td>
                <td className="kw-cell"><b>{x.keyword}</b><div className="faint">{x.adgroup}</div></td>
                <td className="r num">{fmt(x.clicks)}</td><td className="r num">{fmt(x.impressions)}</td>
                <td className="r num">{x.ctr != null ? `${fmt(x.ctr, 2)}%` : "-"}</td>
                <td className="r num">{won(x.cost)}</td>
                <td className="r num faint">{((Number(x[top.sort]) / total) * 100).toFixed(1)}%</td>
                <td className="r num">{won(x.cpc)}</td>
                <td className="r num">{x.avgRank != null ? `${fmt(x.avgRank, 1)}위` : "-"}</td>
                <td><span className={`badge ${g === "S" ? "good" : g === "A" ? "acc" : g === "D" ? "" : "warn"}`}>{g}</span></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </>
  );
}

function PerfTable({ rows, total }: { rows: { key: string; name: string; sub: string; cost: number; impressions: number; clicks: number; ctr: number | null; cpc: number | null; avgRank: number | null; conversions: number }[]; total: number }) {
  return (
    <div className="card mt tbl-wrap"><table>
      <thead><tr><th>이름</th><th className="r">광고비</th><th style={{ width: 120 }}>비중</th><th className="r">노출</th><th className="r">클릭</th><th className="r">CTR</th><th className="r">CPC</th><th className="r">평균순위</th><th className="r">전환</th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={9} className="faint">이 기간의 성과가 없습니다.</td></tr>}
        {rows.map((r) => {
          const share = total ? (Number(r.cost) / Number(total)) * 100 : 0;
          return (
            <tr key={r.key}>
              <td><b>{r.name}</b>{r.sub && <div className="faint">{r.sub}</div>}</td>
              <td className="r num">{won(r.cost)}</td>
              <td><div className="row" style={{ flexWrap: "nowrap" }}><div className="bar" style={{ flex: 1 }}><i style={{ width: `${Math.min(100, share)}%` }} /></div><span className="faint num">{share.toFixed(0)}%</span></div></td>
              <td className="r num">{fmt(r.impressions)}</td><td className="r num">{fmt(r.clicks)}</td>
              <td className="r num">{r.ctr != null ? `${fmt(r.ctr, 2)}%` : "-"}</td><td className="r num">{won(r.cpc)}</td>
              <td className="r num">{fmt(r.avgRank, 1)}</td><td className="r num">{fmt(r.conversions)}</td>
            </tr>
          );
        })}
      </tbody>
    </table></div>
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
    <svg viewBox={`0 0 ${W} ${H}`} className="svg-chart" role="img" aria-label="일별 광고비와 클릭 추이">
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
            <rect x={x(i) - bw * 0.35} y={P.t + ih - h} width={bw * 0.7} height={h} rx={2} className="bar-1"><title>{`${d.date} 광고비 ${fmt(d.cost)}원 · 클릭 ${fmt(d.clicks)}`}</title></rect>
            {i % step === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="axis">{d.date.slice(5).replace("-", "/")}</text>}
          </g>
        );
      })}
      <path d={line} className="line-2" />
    </svg>
  );
}
