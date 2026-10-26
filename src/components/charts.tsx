// 운영 화면용 간단한 도표 (서버 컴포넌트 · SVG/CSS만 사용, 마우스를 올리면 수치가 보인다)
import { daysLeft, dday, itemLabel, itemState, STATE_LABEL, type ContractItem } from "@/lib/month";

// 진행률 도넛: 가운데 퍼센트, 아래 설명
export function Donut({ done, total, label, sub, size = 120 }: { done: number; total: number; label: string; sub?: string; size?: number }) {
  const r = 42, c = 2 * Math.PI * r;
  const rate = total ? Math.min(1, done / total) : 0;
  return (
    <figure className="donut">
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${label} ${Math.round(rate * 100)}%`}>
        <title>{`${label}: ${done} / ${total} (${Math.round(rate * 100)}%)`}</title>
        <circle cx="50" cy="50" r={r} className="donut-track" />
        {rate > 0 && <circle cx="50" cy="50" r={r} className={`donut-fill ${rate >= 1 ? "full" : ""}`} strokeDasharray={`${c * rate} ${c}`} transform="rotate(-90 50 50)" />}
        <text x="50" y="49" className="donut-v">{total ? `${Math.round(rate * 100)}%` : "-"}</text>
        <text x="50" y="64" className="donut-s">{total ? `${done}/${total}` : "항목 없음"}</text>
      </svg>
      <figcaption><b>{label}</b>{sub && <span className="faint">{sub}</span>}</figcaption>
    </figure>
  );
}

// 계약 항목 진행 막대 + 마감 D-day. 회색 세로선 = 오늘 기준 예상 진행 위치
export function ItemBars({ items, period, today }: { items: ContractItem[]; period: string; today: string }) {
  if (items.length === 0) return <div className="empty-state">이번 달 업무 항목이 없습니다.</div>;
  const start = Date.parse(`${period}-01`);
  return (
    <ul className="ibars">
      {items.map((i, k) => {
        const st = itemState(i, period, today);
        const rate = i.quantity ? Math.min(1, i.done / i.quantity) : 1;
        const span = Math.max(1, (Date.parse(i.dueOn) - start) / 86_400_000 + 1);
        const pace = Math.min(1, Math.max(0, ((Date.parse(today) - start) / 86_400_000 + 1) / span));
        const left = daysLeft(i.dueOn, today);
        return (
          <li key={i.id ?? `${i.service}-${k}`} title={`${itemLabel(i)}: ${i.done}/${i.quantity} · 마감 ${i.dueOn.slice(5).replace("-", "/")} (${dday(left)}) · ${STATE_LABEL[st]}`}>
            <div className="ib-h">
              <b>{itemLabel(i)}{i.extra && <span className="badge acc tag-extra" title={i.note ?? "견적 외 추가 진행"}>추가</span>}</b>
              <span className="num">{i.done}<span className="faint"> / {i.quantity}</span></span>
            </div>
            <div className={`ib-bar ${st}`}>
              <i style={{ width: `${rate * 100}%` }} />
              {st !== "done" && <s style={{ left: `${pace * 100}%` }} aria-hidden="true" />}
            </div>
            <div className="ib-f">
              <span className={`badge ${{ done: "good", late: "bad", risk: "warn", ok: "acc" }[st]}`}>{STATE_LABEL[st]}</span>
              <span className="faint">마감 {i.dueOn.slice(5).replace("-", "/")} · {st === "done" ? "완료" : dday(left)}{!i.auto && !i.fallback ? " · 직접 입력" : ""}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// 월간 일정표: 1일~말일 위에 항목별 기간(1일~마감일)과 진행 정도, 오늘 위치
export function MonthTimeline({ items, period, days, today }: { items: ContractItem[]; period: string; days: number; today: string }) {
  if (items.length === 0) return null;
  const W = 640, L = 132, R = 12, rowH = 26, top = 22;
  const H = top + items.length * rowH + 8;
  const x = (d: number) => L + ((d - 1) / Math.max(1, days - 1)) * (W - L - R);
  const day = (iso: string) => Math.min(days, Math.max(1, iso.startsWith(period) ? Number(iso.slice(8, 10)) : iso < period ? 1 : days));
  const isCur = today.startsWith(period);
  const ticks = [1, 5, 10, 15, 20, 25, days];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svg-chart timeline" role="img" aria-label="월간 일정표">
      {ticks.map((t) => (
        <g key={t}><line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 4} className="grid-line" /><text x={x(t)} y={12} className="axis" textAnchor="middle">{t}일</text></g>
      ))}
      {items.map((i, k) => {
        const st = itemState(i, period, today);
        const y = top + k * rowH;
        const end = day(i.dueOn);
        const rate = i.quantity ? Math.min(1, i.done / i.quantity) : 1;
        const name = itemLabel(i);
        return (
          <g key={i.id ?? k}>
            <title>{`${name}: ${i.done}/${i.quantity} · 마감 ${i.dueOn.slice(5).replace("-", "/")} · ${STATE_LABEL[st]}`}</title>
            <text x={0} y={y + 13} className="tl-name">{name.length > 11 ? `${name.slice(0, 10)}…` : name}</text>
            <rect x={x(1)} y={y + 4} width={Math.max(4, x(end) - x(1))} height={12} rx={4} className="tl-span" />
            <rect x={x(1)} y={y + 4} width={Math.max(rate > 0 ? 4 : 0, (x(end) - x(1)) * rate)} height={12} rx={4} className={`tl-done ${st}`} />
            <circle cx={x(end)} cy={y + 10} r={4.5} className={`tl-due ${st}`} />
          </g>
        );
      })}
      {isCur && <g><line x1={x(day(today))} x2={x(day(today))} y1={top - 6} y2={H - 4} className="tl-today" /><text x={x(day(today))} y={top - 8} className="tl-today-t" textAnchor="middle">오늘</text></g>}
    </svg>
  );
}

// 광고비 누적 소진 (한 축: 원). 점선 = 월 예산을 날짜만큼 나눈 계획선
export function SpendChart({ daily, budget, days, period }: { daily: { date: string; cost: number }[]; budget: number | null; days: number; period: string }) {
  const W = 640, H = 200, L = 56, R = 12, T = 12, B = 24;
  const byDay = new Map(daily.map((d) => [Number(d.date.slice(8, 10)), Number(d.cost)]));
  const lastDay = daily.length ? Math.max(...byDay.keys()) : 0;
  const cum: { d: number; v: number }[] = [];
  let s = 0;
  for (let d = 1; d <= lastDay; d++) { s += byDay.get(d) ?? 0; cum.push({ d, v: s }); }
  const max = Math.max(budget ?? 0, s, 1) * 1.08;
  const x = (d: number) => L + ((d - 1) / Math.max(1, days - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const fmt = (v: number) => (v >= 10000 ? `${Math.round(v / 10000).toLocaleString("ko-KR")}만` : Math.round(v).toLocaleString("ko-KR"));
  const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svg-chart" role="img" aria-label="광고비 누적 소진">
      {steps.map((v, k) => <g key={k}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid-line" /><text x={L - 6} y={y(v) + 4} className="axis" textAnchor="end">{fmt(v)}</text></g>)}
      {[1, 10, 20, days].map((d) => <text key={d} x={x(d)} y={H - 6} className="axis" textAnchor="middle">{Number(period.slice(5))}/{d}</text>)}
      {budget ? <line x1={x(1)} y1={y(budget / days)} x2={x(days)} y2={y(budget)} className="plan-line"><title>{`예산 계획: 월 ${fmt(budget)}원`}</title></line> : null}
      {cum.length > 1 && <polyline points={cum.map((p) => `${x(p.d)},${y(p.v)}`).join(" ")} className="line-1" />}
      {cum.map((p) => (
        <circle key={p.d} cx={x(p.d)} cy={y(p.v)} r={7} className="hit"><title>{`${Number(period.slice(5))}/${p.d} 누적 ${Math.round(p.v).toLocaleString("ko-KR")}원 (당일 ${Math.round(byDay.get(p.d) ?? 0).toLocaleString("ko-KR")}원)`}</title></circle>
      ))}
      {cum.length > 0 && <circle cx={x(cum[cum.length - 1].d)} cy={y(s)} r={4} className="dot-1" />}
    </svg>
  );
}

// 월별 달성률 막대 (최근 6개월)
export function HistoryBars({ rows }: { rows: { period: string; quantity: number; done: number }[] }) {
  if (rows.length === 0) return <div className="empty-state">등록된 월별 기록이 없습니다.</div>;
  const W = 640, H = 170, L = 36, R = 8, T = 16, B = 24;
  const bw = Math.min(56, (W - L - R) / rows.length - 16);
  const y = (f: number) => T + (1 - f) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="svg-chart" role="img" aria-label="월별 계약 달성률">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={y(f)} y2={y(f)} className="grid-line" /><text x={L - 6} y={y(f) + 4} className="axis" textAnchor="end">{f * 100}%</text></g>)}
      {rows.map((r, k) => {
        const f = r.quantity ? Math.min(1, r.done / r.quantity) : 0;
        const cx = L + ((k + 0.5) * (W - L - R)) / rows.length;
        return (
          <g key={r.period}>
            <title>{`${r.period.replace("-", "년 ")}월: ${r.done}/${r.quantity} (${Math.round(f * 100)}%)`}</title>
            <rect x={cx - bw / 2} y={y(f)} width={bw} height={Math.max(0, y(0) - y(f))} rx={4} className="bar-1" />
            <text x={cx} y={y(f) - 4} className="axis val" textAnchor="middle">{Math.round(f * 100)}%</text>
            <text x={cx} y={H - 6} className="axis" textAnchor="middle">{Number(r.period.slice(5))}월</text>
          </g>
        );
      })}
    </svg>
  );
}
