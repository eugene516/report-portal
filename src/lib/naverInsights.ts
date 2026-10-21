// 네이버 광고 성과 분석 · 개선 제안 (데이터 기준 규칙)
// 화면에 "왜 이런 제안인지" 근거 수치를 함께 보여주도록 detail 에 숫자를 담는다.
import type { NaverReport } from "./report";

export type Insight = { level: "good" | "warn" | "bad" | "info"; title: string; detail: string; action?: string };

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const pctChange = (now: number | null | undefined, prev: number | null | undefined) =>
  now == null || prev == null || prev === 0 ? null : ((now - prev) / prev) * 100;
export const DOW = ["", "월", "화", "수", "목", "금", "토", "일"];

export function budgetStatus(d: NaverReport) {
  const m = d.month;
  if (!m) return null;
  // 월말 예상 = 이번 달 누적 + 최근 7일 일평균 × 남은 일수 (월 중간에 시작한 광고도 과소 추정하지 않도록)
  const remaining = Math.max(0, m.daysInMonth - m.elapsedDays);
  const daily = d.recentDailyAvg != null ? Number(d.recentDailyAvg) : m.elapsedDays > 0 ? Number(m.spent) / m.elapsedDays : 0;
  const projected = Number(m.spent) + daily * remaining;
  const daysLeft = d.bizmoney?.amount != null && d.recentDailyAvg ? Number(d.bizmoney.amount) / Number(d.recentDailyAvg) : null;
  return { spent: Number(m.spent), budget: m.budget != null ? Number(m.budget) : null, projected, elapsed: m.elapsedDays, days: m.daysInMonth, month: m.month, daysLeft };
}

export function buildInsights(d: NaverReport): Insight[] {
  const out: Insight[] = [];
  const k = d.kpi, p = d.prev;
  const b = budgetStatus(d);

  // 1) 광고비 소진
  if (b?.budget) {
    const pace = b.projected / b.budget * 100;
    if (pace > 110) out.push({ level: "bad", title: "월 예산 초과 소진 예상", detail: `${b.month} 누적 ${won(b.spent)} · 이 속도면 월말 ${won(b.projected)} (예산 ${won(b.budget)}의 ${pace.toFixed(0)}%)`, action: "일 예산 또는 고비용 키워드 입찰가를 낮춰 소진 속도를 조절하세요." });
    else if (pace < 80) out.push({ level: "warn", title: "월 예산 대비 소진이 느림", detail: `월말 예상 ${won(b.projected)} (예산의 ${pace.toFixed(0)}%)`, action: "노출이 부족한 핵심 키워드의 입찰가를 올리거나 키워드를 확장해 예산을 활용하세요." });
    else out.push({ level: "good", title: "예산 소진 속도 적정", detail: `월말 예상 ${won(b.projected)} (예산의 ${pace.toFixed(0)}%)` });
  }
  if (b?.daysLeft != null) {
    if (b.daysLeft < 7) out.push({ level: "bad", title: `비즈머니 약 ${Math.max(0, Math.floor(b.daysLeft))}일 후 소진 예상`, detail: `잔액 ${won(Number(d.bizmoney!.amount))} · 최근 7일 일평균 ${won(Number(d.recentDailyAvg))}`, action: "광고가 중단되지 않도록 비즈머니를 충전하세요." });
    else if (b.daysLeft < 14) out.push({ level: "warn", title: `비즈머니 약 ${Math.floor(b.daysLeft)}일분 남음`, detail: `잔액 ${won(Number(d.bizmoney!.amount))}`, action: "다음 주 안에 충전 일정을 잡아 두세요." });
  }
  if (d.bizmoney?.budgetLock) out.push({ level: "bad", title: "예산 잠금 상태", detail: "네이버 광고 계정에 예산 잠금이 걸려 있습니다.", action: "검색광고 관리자에서 예산 잠금 사유를 확인하세요." });

  // 2) 이전 기간 대비
  if (p) {
    const ctrCh = pctChange(k.ctr, p.ctr), cpcCh = pctChange(k.cpc, p.cpc), clkCh = pctChange(k.clicks, p.clicks);
    if (clkCh != null && Math.abs(clkCh) >= 15) out.push({ level: clkCh > 0 ? "good" : "warn", title: `클릭 ${clkCh > 0 ? "증가" : "감소"} ${Math.abs(clkCh).toFixed(0)}%`, detail: `이전 기간 ${p.clicks}회 → ${k.clicks}회` });
    if (cpcCh != null && cpcCh >= 15) out.push({ level: "warn", title: `클릭당 비용(CPC) ${cpcCh.toFixed(0)}% 상승`, detail: `${won(p.cpc ?? 0)} → ${won(k.cpc ?? 0)}`, action: "경쟁 입찰이 늘었을 수 있습니다. 순위 대비 효율이 낮은 키워드의 입찰가를 점검하세요." });
    if (ctrCh != null && ctrCh <= -15) out.push({ level: "warn", title: `클릭률(CTR) ${Math.abs(ctrCh).toFixed(0)}% 하락`, detail: `${p.ctr}% → ${k.ctr}%`, action: "광고 문구와 확장소재(전화번호·위치·이미지)를 점검하세요." });
  }

  // 3) 효율
  if (k.ctr != null && k.ctr < 1 && k.impressions > 1000) out.push({ level: "warn", title: `클릭률 ${k.ctr}%로 낮음`, detail: `노출 ${k.impressions.toLocaleString("ko-KR")}회 중 클릭 ${k.clicks}회`, action: "검색 의도와 맞는 문구로 소재를 바꾸고, 노출만 많은 일반 키워드는 제외를 검토하세요." });
  if (k.avgRank != null && k.avgRank > 4) out.push({ level: "info", title: `평균 노출 순위 ${k.avgRank}위`, detail: "모바일 검색에서는 3위 밖이면 노출 효과가 크게 줄어듭니다.", action: "핵심 키워드만 골라 입찰가를 올려 상위 노출을 확보하세요." });
  if (k.clicks > 0 && Number(k.conversions) === 0) out.push({ level: "warn", title: "전환 데이터 없음", detail: `클릭 ${k.clicks}회 · 전환 0건 (ROAS 계산 불가)`, action: "네이버 프리미엄 로그분석 또는 전환 스크립트를 홈페이지·예약 페이지에 설치하면 문의·예약 성과를 측정할 수 있습니다." });

  // 4) 키워드
  const kws = d.keywords ?? [];
  if (kws.length) {
    const totalCost = kws.reduce((s, x) => s + Number(x.cost), 0);
    const top3 = kws.slice(0, 3);
    const share = totalCost ? top3.reduce((s, x) => s + Number(x.cost), 0) / totalCost * 100 : 0;
    if (share >= 60 && kws.length > 5) out.push({ level: "info", title: `비용 상위 3개 키워드가 전체의 ${share.toFixed(0)}%`, detail: top3.map((x) => `${x.keyword} ${won(Number(x.cost))}`).join(" · "), action: "비용이 몰린 키워드의 성과(클릭·문의)를 확인하고, 효율이 낮으면 입찰가를 낮춰 다른 키워드로 분산하세요." });
    const noClick = kws.filter((x) => Number(x.impressions) >= 100 && Number(x.clicks) === 0);
    if (noClick.length) out.push({ level: "warn", title: `노출 100회 이상 · 클릭 0회 키워드 ${noClick.length}개`, detail: noClick.slice(0, 5).map((x) => `${x.keyword}(${Number(x.impressions).toLocaleString("ko-KR")}회)`).join(", "), action: "검색 의도가 맞지 않으면 제외하고, 맞다면 해당 키워드 전용 문구를 만들어 클릭률을 높이세요." });
    const gems = kws.filter((x) => Number(x.impressions) < 100 && Number(x.clicks) >= 2 && Number(x.ctr ?? 0) >= 3);
    if (gems.length) out.push({ level: "good", title: `노출은 적지만 반응 좋은 키워드 ${gems.length}개`, detail: gems.slice(0, 5).map((x) => `${x.keyword}(CTR ${x.ctr}%)`).join(", "), action: "입찰가를 올려 노출을 늘리면 효율 좋은 클릭을 더 얻을 수 있습니다." });
  }

  // 5) 요일
  const wd = (d.weekday ?? []).filter((w) => Number(w.impressions) > 0);
  if (wd.length >= 5) {
    const ctrOf = (w: (typeof wd)[number]) => Number(w.clicks) / Number(w.impressions) * 100;
    const best = [...wd].sort((a, b2) => ctrOf(b2) - ctrOf(a))[0], worst = [...wd].sort((a, b2) => ctrOf(a) - ctrOf(b2))[0];
    if (ctrOf(best) > ctrOf(worst) * 1.5) out.push({ level: "info", title: `${DOW[best.dow]}요일 반응이 가장 좋음`, detail: `CTR ${DOW[best.dow]} ${ctrOf(best).toFixed(2)}% / ${DOW[worst.dow]} ${ctrOf(worst).toFixed(2)}%`, action: `반응 좋은 요일에 입찰을 높이고, ${DOW[worst.dow]}요일은 입찰 가중치를 낮추는 시간·요일 설정을 검토하세요.` });
  }
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b2) => order[a.level] - order[b2.level]);
}

// 키워드 등급 (엑셀 파워링크 리포트와 같은 기준)
export function keywordGrade(imp: number, clk: number): "S" | "A" | "B" | "C" | "D" {
  return imp >= 100 && clk > 0 ? "S" : imp >= 50 ? "A" : clk > 0 ? "B" : imp >= 10 ? "C" : "D";
}
