// 내부용 메인 대시보드: 당월(1일~말일) 계약 수량 진행과 업무 마감 중심
// - 오너·관리자: 전체 광고주 (담당 직원별로 좁혀 보기)
// - 직원: 본인 담당 광고주만
// 어떤 광고주를 볼 수 있는지는 DB 함수(month_overview)가 호출자 권한으로 결정한다. 순위는 표시하지 않는다.
import Link from "next/link";
import { isAdminRole, requireStaff } from "@/lib/auth";
import { getStaffOverview } from "@/lib/dashboard";
import { currentPeriod, SERVICE_LABELS } from "@/lib/content";
import { daysLeft, dday, getInHouseIds, getMonthOverview, itemLabel, itemState, monthInfo, totals, type MonthClient } from "@/lib/month";
import { Donut } from "@/components/charts";
import { supabaseForStaff } from "@/lib/supabase/server";

export const metadata = { title: "운영 대시보드 · 리포트 포털" };
export const dynamic = "force-dynamic";

type Alert = { level: "high" | "mid" | "info"; client: MonthClient; text: string; href: string };

function alertsOf(rows: MonthClient[], period: string, today: string, inHouse: Set<string>): Alert[] {
  const out: Alert[] = [];
  for (const c of rows) {
    const base = `/admin/clients/${c.id}`;
    if (c.sync_failed_7d > 0) out.push({ level: "high", client: c, text: `네이버 광고 수집 실패 ${c.sync_failed_7d}건 (최근 7일)`, href: `${base}/settings` });
    if (c.cafe_deleted > 0) out.push({ level: "high", client: c, text: `카페 게시글 삭제 ${c.cafe_deleted}건 → AS 확인`, href: `${base}/cafe` });
    for (const i of c.items) {
      if (itemState(i, period, today) === "late") out.push({ level: "high", client: c, text: `${itemLabel(i)} 마감 지남 (${i.done}/${i.quantity})`, href: `/admin/progress/${c.id}` });
    }
    if (inHouse.has(c.id)) { /* 자사 마케팅: 계약 · 견적 확인 대상 아님 */ }
    else if (!c.contract) out.push({ level: "mid", client: c, text: "이번 달 계약 내용이 등록되지 않았습니다", href: `${base}/contracts` });
    else if (c.files === 0) out.push({ level: "info", client: c, text: "이번 달 견적서·계약서 파일이 없습니다", href: `${base}/contracts` });
    if (!c.staff.some((s) => s.primary)) out.push({ level: "mid", client: c, text: "주담당 직원이 지정되지 않았습니다", href: `${base}/settings` });
    if (c.channels.naver?.contracted && !c.channels.naver.apiConnected) out.push({ level: "mid", client: c, text: "네이버 광고 계약 · API 키 미등록", href: `${base}/settings` });
    // 계약한 항목의 자료가 3일 넘게 갱신되지 않았으면 경고 (블로그·플레이스 순위, 카페 확인, 네이버 광고)
    const svc = new Set([...c.items.map((i) => i.service), ...(c.services ?? [])]);
    const stale: [boolean, string | null, string, string][] = [
      [svc.has("blog"), c.collected?.blog ?? null, "블로그 순위", `${base}/blog`],
      [svc.has("place"), c.collected?.place ?? null, "플레이스 순위", `${base}/place`],
      [svc.has("cafe"), c.collected?.cafe ?? null, "카페 게시글 확인", `${base}/cafe`],
      [!!(c.channels.naver?.contracted && c.channels.naver.apiConnected), c.collected?.naver ?? null, "네이버 광고 수집", `${base}/ads/naver`],
    ];
    for (const [on, at, label, href] of stale) {
      if (!on) continue;
      if (!at) out.push({ level: "info", client: c, text: `${label} 수집 이력이 없습니다`, href });
      else if (Date.parse(today) - Date.parse(at) > 3 * 86_400_000) out.push({ level: "mid", client: c, text: `${label} 3일 넘게 갱신 안 됨 (마지막 ${at.slice(5, 10).replace("-", "/")})`, href });
    }
  }
  const order = { high: 0, mid: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireStaff();
  const sp = await searchParams;
  const period = sp.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period) ? sp.period : currentPeriod();
  const isAdmin = isAdminRole(me.role);
  const [all, staffList, inHouse] = await Promise.all([getMonthOverview(period), isAdmin ? getStaffOverview() : Promise.resolve([]), getInHouseIds()]);
  const mi = monthInfo(period);
  // 지난 달은 말일 기준, 다가오는 달은 1일 기준으로 마감 상태를 판단한다
  const today = mi.isCurrent ? mi.today : period < mi.today.slice(0, 7) ? mi.last : `${period}-01`;

  const staffFilter = isAdmin ? sp.staff : undefined;
  const rows = staffFilter ? all.filter((c) => c.staff.some((s) => s.id === staffFilter)) : all;
  const items = rows.flatMap((c) => c.items.map((i) => ({ ...i, client: c, st: itemState(i, period, today) })));
  const t = totals(items);
  const open = items.filter((i) => i.st !== "done").sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const soon = open.filter((i) => { const l = daysLeft(i.dueOn, today); return l >= 0 && l <= 3; });
  const late = open.filter((i) => i.st === "late");
  const noContract = rows.filter((c) => !c.contract && !inHouse.has(c.id));   // 자사 마케팅은 계약 대상이 아님
  const alerts = alertsOf(rows, period, today, inHouse);
  // 파일 검수: 광고주 수정 요청 (담당 광고주만 — RLS)
  const { data: changes } = await (await supabaseForStaff()).from("review_items").select("id, client_id, title").eq("status", "changes");
  for (const r of changes ?? []) {
    const c = rows.find((x) => x.id === r.client_id);
    if (c) alerts.unshift({ level: "high", client: c, text: `파일 검수 수정 요청: ${r.title}`, href: `/admin/clients/${c.id}/review/${r.id}` });
  }
  const pace = mi.days ? mi.elapsed / mi.days : 0;

  // 업무 종류별 합계
  const bySvc = new Map<string, { done: number; total: number; count: number }>();
  for (const i of items) {
    const v = bySvc.get(i.service) ?? { done: 0, total: 0, count: 0 };
    v.done += Math.min(i.done, i.quantity); v.total += i.quantity; v.count += 1;
    bySvc.set(i.service, v);
  }
  // 광고주별 진행률 (마감 지남 → 지연 위험 → 진행률 낮은 순)
  const clientRates = rows.map((c) => {
    const sts = c.items.map((i) => itemState(i, period, today));
    return { c, ...totals(c.items), late: sts.includes("late"), risk: sts.includes("risk") };
  }).sort((a, b) => Number(b.late) - Number(a.late) || Number(b.risk) - Number(a.risk) || a.rate - b.rate);
  // 직원별 업무량 (주담당 기준)
  const byStaff = staffList.map((s) => {
    const mine = all.filter((c) => c.staff.some((x) => x.id === s.id && x.primary));
    return { s, clients: mine.length, ...totals(mine.flatMap((c) => c.items)), late: mine.reduce((n, c) => n + c.items.filter((i) => itemState(i, period, today) === "late").length, 0) };
  }).filter((x) => x.clients > 0);
  const maxStaffQty = Math.max(1, ...byStaff.map((x) => x.quantity));
  const staffName = staffList.find((s) => s.id === staffFilter)?.name;
  const stripNote = mi.isCurrent ? `오늘 ${today.slice(5).replace("-", "/")} · ${mi.elapsed}/${mi.days}일 경과 · 말일까지 ${mi.days - mi.elapsed}일`
    : mi.elapsed === mi.days ? "지난 달 (마감된 기간)" : "다가오는 달";

  return (
    <div className="ops">
      {sp.denied && <div className="notice">관리자만 사용할 수 있는 메뉴입니다.</div>}
      <header className="ops-head-in">
        <div>
          <div className="faint">믿는구석 · {isAdmin ? (staffName ? `${staffName} 담당 광고주` : "전체 광고주") : "내 담당 광고주"}</div>
          <h1>{mi.label} 운영 현황</h1>
        </div>
        <form className="row" method="get">
          <label className="faint" htmlFor="period">보고 월</label>
          <input id="period" type="month" name="period" defaultValue={period} className="search date" />
          {isAdmin && (
            <select name="staff" defaultValue={staffFilter ?? ""} aria-label="담당 직원">
              <option value="">전체 직원</option>
              {staffList.filter((s) => s.clients.length > 0).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button className="btn sm">보기</button>
        </form>
      </header>

      {/* 오늘 할 일: 마감 · 지연 · 확인 필요 (가장 먼저 보는 영역) */}
      <div className="today-grid mt">
        <section className="card" id="deadlines">
          <div className="card-h pad-h"><h2>마감 · 지연 업무</h2><span className="faint">지남 {late.length} · 3일 이내 {soon.length} · 미완료 {open.length}</span></div>
          <ul className="dl-list">
            {open.length === 0 && <li className="faint pad-x">남은 업무가 없습니다.</li>}
            {open.slice(0, 30).map((i, k) => (
              <li key={`${i.client.id}-${i.id ?? i.service}-${k}`}>
                <Link href={`/admin/progress/${i.client.id}`}>
                  <span className={`dd ${i.st}`}>{dday(daysLeft(i.dueOn, today))}</span>
                  <span className="t"><b>{i.client.name}</b><span>{itemLabel(i)} · {i.done}/{i.quantity} · {i.dueOn.slice(5).replace("-", "/")} 마감</span>
                    <span className="bar thin"><i style={{ width: `${i.quantity ? Math.min(100, (i.done / i.quantity) * 100) : 0}%` }} /></span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

      <section className="card" id="alerts">
          <div className="card-h pad-h"><h2>확인 필요</h2><span className="faint">{alerts.length}건</span></div>
          <ul className="alerts">
            {alerts.length === 0 && <li className="faint pad-x">확인할 항목이 없습니다.</li>}
            {alerts.slice(0, 40).map((a, i) => (
              <li key={i}><Link href={a.href}><span className={`lv ${a.level}`} /><span className="t"><b>{a.client.name}</b><span>{a.text}</span></span></Link></li>
            ))}
          </ul>
        </section>
        </div>

      {noContract.length === rows.length && rows.length > 0 ? (
        <section className="card pad mt empty-guide">
          <h2>{mi.label} 계약을 먼저 등록하세요</h2>
          <p className="faint">계약 수량과 마감일을 등록하면 이 화면에 진행률 · 마감 · 업무별 그래프가 나타납니다.</p>
          <div className="row mt">{rows.map((c) => <Link key={c.id} href={`/admin/clients/${c.id}/contracts?period=${period}`} className="btn">{c.name} 계약 등록</Link>)}</div>
        </section>
      ) : (
        <>
        {/* 이번 달 경과 vs 업무 진행 */}
        <section className="card pad mt month-strip">
          <div className="ms-l">
            <b>{period.slice(5)}/01 ~ {mi.last.slice(5).replace("-", "/")}</b>
            <span className="faint">{stripNote}</span>
          </div>
          <div className="ms-bars" title={`기간 경과 ${Math.round(pace * 100)}% · 계약 수량 진행 ${Math.round(t.rate * 100)}%`}>
            <div className="ms-row"><span className="faint">기간 경과</span><div className="bar"><i className="time" style={{ width: `${pace * 100}%` }} /></div><span className="num">{Math.round(pace * 100)}%</span></div>
            <div className="ms-row"><span className="faint">업무 진행</span><div className="bar"><i style={{ width: `${t.rate * 100}%` }} /></div><span className="num">{Math.round(t.rate * 100)}%</span></div>
          </div>
        </section>
  
        {/* 요약 */}
        <div className="grid dash-kpi mt">
          <div className="card kpi static donut-card">
            <Donut done={t.done} total={t.quantity} label="계약 수량 진행" sub={`광고주 ${rows.length}곳 · 항목 ${items.length}개`} size={104} />
          </div>
          <a href="#deadlines" className={`card kpi ${soon.length ? "warn-b" : ""}`}><div className="label">마감 임박 (3일 이내)</div><div className="value num">{soon.length}<small>건</small></div><div className="foot">아직 끝나지 않은 업무</div></a>
          <a href="#deadlines" className={`card kpi ${late.length ? "alert" : ""}`}><div className="label">마감 지남</div><div className="value num">{late.length}<small>건</small></div><div className="foot">수량 미달인 채 마감일 경과</div></a>
          <Link href="/admin/clients" className={`card kpi ${noContract.length ? "warn-b" : ""}`}><div className="label">계약 미등록</div><div className="value num">{noContract.length}<small>/ {rows.filter((c) => !inHouse.has(c.id)).length}곳</small></div><div className="foot">이번 달 견적·계약 등록 필요</div></Link>
          <a href="#alerts" className={`card kpi ${alerts.some((a) => a.level === "high") ? "alert" : ""}`}><div className="label">확인 필요</div><div className="value num">{alerts.length}<small>건</small></div><div className="foot">긴급 {alerts.filter((a) => a.level === "high").length} · 주의 {alerts.filter((a) => a.level === "mid").length}</div></a>
        </div>
  
  
          <section className="card pad mt">
            <div className="card-h"><h2>광고주별 진행률</h2><span className="faint">막대 = 계약 수량 진행 · 세로선 = 오늘까지 기간 경과</span></div>
            {clientRates.length === 0 && <div className="empty-state">{isAdmin ? "등록된 광고주가 없습니다." : "담당 광고주가 없습니다."}</div>}
            <ul className="crates">
              {clientRates.map(({ c, done, quantity, rate, late: isLate, risk }) => (
                <li key={c.id}>
                  <Link href={`/admin/progress/${c.id}${staffFilter ? `?staff=${staffFilter}` : ""}`} title={`${c.name}: ${done}/${quantity} (${Math.round(rate * 100)}%)`}>
                    <span className="cr-name"><b>{c.name}</b><span className="faint">{c.staff.find((s) => s.primary)?.name ?? "주담당 없음"}{!c.contract && !inHouse.has(c.id) && " · 계약 미등록"}</span></span>
                    <span className={`cr-bar ${isLate ? "late" : risk ? "risk" : rate >= 1 ? "done" : "ok"}`}>
                      <i style={{ width: `${rate * 100}%` }} />
                      {mi.isCurrent && <s style={{ left: `${pace * 100}%` }} />}
                    </span>
                    <span className="cr-v num">{quantity ? `${Math.round(rate * 100)}%` : "-"}<span className="faint"> {done}/{quantity}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="legend mt-s">
              <span><i className="lg ok" />순조</span><span><i className="lg risk" />지연 위험</span><span><i className="lg late" />마감 지남</span><span><i className="lg done" />완료</span>
            </div>
          </section>
  
  
  
        <section className="card pad mt">
          <div className="card-h"><h2>업무별 진행</h2><span className="faint">광고주 합계</span></div>
          {bySvc.size === 0 ? <div className="empty-state">이번 달 계약 항목이 없습니다.</div> : (
            <div className="donuts">
              {[...bySvc.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => (
                <Donut key={k} done={v.done} total={v.total} label={k === "etc" ? "기타 업무" : SERVICE_LABELS[k] ?? k} sub={`항목 ${v.count}개`} size={92} />
              ))}
            </div>
          )}
        </section>
  
        {isAdmin && !staffFilter && byStaff.length > 0 && (
          <section className="card pad mt">
            <div className="card-h"><h2>직원별 업무 현황</h2><span className="faint">주담당 광고주 기준 · 막대 길이 = 계약 수량, 진한 부분 = 완료</span></div>
            <ul className="crates">
              {byStaff.map((x) => (
                <li key={x.s.id}>
                  <Link href={`/admin?period=${period}&staff=${x.s.id}`} title={`${x.s.name}: ${x.done}/${x.quantity}건 · 광고주 ${x.clients}곳`}>
                    <span className="cr-name"><b>{x.s.name}</b><span className="faint">광고주 {x.clients}곳{x.late ? ` · 마감 지남 ${x.late}` : ""}</span></span>
                    <span className="sb-track"><span className="sb-total" style={{ width: `${(x.quantity / maxStaffQty) * 100}%` }}><i style={{ width: `${x.quantity ? (x.done / x.quantity) * 100 : 0}%` }} /></span></span>
                    <span className="cr-v num">{x.done}<span className="faint"> / {x.quantity}건</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
  
          </>
      )}
    </div>
  );
}
