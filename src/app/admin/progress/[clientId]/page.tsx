// 광고주 진행 현황 (내부용): 당월 계약 항목 진행 · 마감 일정 · 광고비 소진 · 월별 달성률
// 좌측 메뉴의 직원 → 담당 업체, 또는 대시보드에서 업체 이름을 누르면 열린다.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { currentPeriod } from "@/lib/content";
import { daysLeft, getMonthDetail, getMonthOverview, itemState, monthInfo, totals, won } from "@/lib/month";
import { Donut, HistoryBars, ItemBars, MonthTimeline, SpendChart } from "@/components/charts";

export const metadata = { title: "광고주 진행 현황 · 리포트 포털" };
export const dynamic = "force-dynamic";

export default async function ProgressPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStaff();
  const { clientId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(clientId)) notFound();
  const period = sp.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period) ? sp.period : currentPeriod();
  const [rows, detail] = await Promise.all([getMonthOverview(period, clientId), getMonthDetail(clientId, period)]);
  const c = rows[0];
  if (!c || !detail) notFound();   // 담당이 아니면 DB 함수가 거부한다
  const mi = monthInfo(period);
  const today = mi.isCurrent ? mi.today : period < mi.today.slice(0, 7) ? mi.last : `${period}-01`;
  const t = totals(c.items);
  const sts = c.items.map((i) => itemState(i, period, today));
  const nv = c.channels.naver;
  const contractEnd = c.contract?.endsOn ?? mi.last;
  const left = daysLeft(contractEnd, today);
  const primary = c.staff.find((s) => s.primary);

  return (
    <div className="ops">
      <header className="ops-head-in">
        <div>
          <div className="faint">{[c.category, c.area].filter(Boolean).join(" · ") || "광고주"} · 주담당 {primary?.name ?? "없음"}{c.staff.filter((s) => !s.primary).length > 0 && ` · 보조 ${c.staff.filter((s) => !s.primary).map((s) => s.name).join(", ")}`}</div>
          <h1>{c.name} <span className="h-sub">{mi.label} 진행 현황</span></h1>
        </div>
        <div className="row">
          <form className="row" method="get">
            {sp.staff && <input type="hidden" name="staff" value={sp.staff} />}
            <input type="month" name="period" defaultValue={period} className="search date" aria-label="보고 월" />
            <button className="btn sm">보기</button>
          </form>
          <Link href={`/admin/clients/${c.id}`} className="btn">리포트 열기</Link>
          <Link href={`/admin/clients/${c.id}/contracts?period=${period}`} className="btn primary">계약 · 견적 관리</Link>
          <Link href={`/admin/clients/${c.id}/settings`} className="btn">설정</Link>
        </div>
      </header>

      {!c.contract && (
        <div className="notice mt">
          {mi.label} 계약 내용이 아직 등록되지 않았습니다. {c.items.length > 0 ? "아래는 리포트 계약 항목의 월 목표로 대신 계산한 값이며, 마감일은 말일로 표시합니다." : ""}
          <Link href={`/admin/clients/${c.id}/contracts?period=${period}`} className="btn sm">지금 등록하기</Link>
        </div>
      )}

      <div className="grid dash-kpi mt">
        <div className="card kpi static donut-card"><Donut done={t.done} total={t.quantity} label="계약 수량 진행" sub={`항목 ${c.items.length}개 · 완료 ${sts.filter((s) => s === "done").length}`} size={104} /></div>
        <div className={`card kpi static ${left < 0 && t.rate < 1 ? "alert" : left <= 5 && t.rate < 1 ? "warn-b" : ""}`}>
          <div className="label">계약 기간 종료까지</div>
          <div className="value num">{left >= 0 ? left : 0}<small>일</small></div>
          <div className="foot">{(c.contract?.startsOn ?? `${period}-01`).slice(5).replace("-", "/")} ~ {contractEnd.slice(5).replace("-", "/")} · {mi.isCurrent ? `${mi.elapsed}/${mi.days}일 경과` : mi.elapsed === mi.days ? "종료" : "시작 전"}</div>
        </div>
        <div className={`card kpi static ${sts.includes("late") ? "alert" : sts.includes("risk") ? "warn-b" : ""}`}>
          <div className="label">마감 지남 · 지연 위험</div>
          <div className="value num">{sts.filter((s) => s === "late").length}<small>/ {sts.filter((s) => s === "risk").length}건</small></div>
          <div className="foot">순조 {sts.filter((s) => s === "ok").length}건</div>
        </div>
        <div className="card kpi static">
          <div className="label">계약 금액</div>
          <div className="value num sm-v">{c.contract?.amount != null ? won(c.contract.amount) : "-"}</div>
          <div className="foot">견적서·계약서 파일 {c.files}개</div>
        </div>
        {nv?.contracted ? (
          <div className="card kpi static donut-card">
            {nv.budget ? <Donut done={Math.round(nv.spent ?? 0)} total={nv.budget} label="네이버 광고비 소진" sub={`${won(nv.spent)} / ${won(nv.budget)}`} size={104} />
              : <><div className="label">네이버 광고비</div><div className="value num sm-v">{won(nv.spent)}</div><div className="foot">월 예산 미입력 (설정에서 입력)</div></>}
          </div>
        ) : <div className="card kpi static empty"><div className="label">온라인 광고</div><div className="value">미집행</div></div>}
      </div>

      <div className="grid g-auto mt">
        <section className="card pad">
          <div className="card-h"><h2>계약 항목별 진행</h2><span className="faint">세로선 = 마감일까지 오늘의 예상 진행 위치</span></div>
          <ItemBars items={c.items} period={period} today={today} />
          {c.items.some((i) => !i.auto && !i.fallback) && <p className="faint mt-s">‘직접 입력’ 항목의 진행 수량은 <Link href={`/admin/clients/${c.id}/contracts?period=${period}`}>계약 · 견적 관리</Link>에서 입력합니다.</p>}
        </section>
        <section className="card pad">
          <div className="card-h"><h2>월간 일정표</h2><span className="faint">막대 = 1일~마감일 · 진한 부분 = 진행 · 점 = 마감</span></div>
          {c.items.length ? <MonthTimeline items={c.items} period={period} days={mi.days} today={today} /> : <div className="empty-state">계약 항목이 없습니다.</div>}
          <div className="legend mt-s"><span><i className="lg ok" />순조</span><span><i className="lg risk" />지연 위험</span><span><i className="lg late" />마감 지남</span><span><i className="lg done" />완료</span></div>
        </section>
      </div>

      <div className="grid g-auto mt">
        {nv?.contracted && (
          <section className="card pad">
            <div className="card-h"><h2>네이버 광고비 누적 소진</h2><span className="faint">실선 = 누적 광고비{nv.budget ? " · 점선 = 예산 계획" : ""}</span></div>
            {detail.adDaily.length ? <SpendChart daily={detail.adDaily} budget={nv.budget} days={mi.days} period={period} /> : <div className="empty-state">이번 달 수집된 광고비가 없습니다.</div>}
          </section>
        )}
        <section className="card pad">
          <div className="card-h"><h2>월별 계약 달성률</h2><span className="faint">최근 6개월 · 등록된 계약 기준</span></div>
          <HistoryBars rows={detail.history} />
        </section>
        {c.contract?.memo && (
          <section className="card pad">
            <h2>계약 메모</h2>
            <p className="note-body mt-s">{c.contract.memo}</p>
          </section>
        )}
      </div>
    </div>
  );
}
