// 광고주 현황: 당월 계약 · 진행률 · 다음 마감 · 광고비 소진 (순위는 표시하지 않는다)
import Link from "next/link";
import { isAdminRole, requireStaff } from "@/lib/auth";
import { getStaffOverview } from "@/lib/dashboard";
import { currentPeriod } from "@/lib/content";
import { daysLeft, dday, getMonthOverview, itemLabel, itemState, monthInfo, totals, won } from "@/lib/month";
import IssueLinkButton from "../IssueLinkButton";

export const metadata = { title: "광고주 현황 · 리포트 포털" };
export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireStaff();
  const sp = await searchParams;
  const isAdmin = isAdminRole(me.role);
  const period = currentPeriod();
  const [all, staffList] = await Promise.all([getMonthOverview(period), isAdmin ? getStaffOverview() : Promise.resolve([])]);
  const mi = monthInfo(period);
  const q = (sp.q ?? "").trim();
  const staffFilter = isAdmin ? sp.staff : undefined;
  let rows = all;
  if (staffFilter) rows = rows.filter((c) => c.staff.some((s) => s.id === staffFilter));
  if (q) rows = rows.filter((c) => c.name.includes(q));
  if (sp.only === "nocontract") rows = rows.filter((c) => !c.contract);
  const staffName = staffList.find((s) => s.id === staffFilter)?.name;

  return (
    <div className="ops">
      <header className="ops-head-in">
        <div>
          <div className="faint">{mi.label} · {staffName ? `${staffName} 담당` : isAdmin ? "전체 광고주" : "내 담당 광고주"} {rows.length}곳</div>
          <h1>광고주 현황</h1>
        </div>
        <div className="row">
          <form className="row" method="get">
            {isAdmin && (
              <select name="staff" defaultValue={staffFilter ?? ""} aria-label="담당 직원">
                <option value="">전체 직원</option>
                {staffList.filter((s) => s.clients.length > 0).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <select name="only" defaultValue={sp.only ?? ""} aria-label="계약 상태">
              <option value="">전체</option><option value="nocontract">이번 달 계약 미등록</option>
            </select>
            <input type="search" name="q" defaultValue={q} placeholder="광고주 검색" className="search" />
            <button className="btn sm">적용</button>
          </form>
          <Link href="/admin/clients/new" className="btn primary">+ 새 광고주</Link>
        </div>
      </header>

      <section className="card mt">
        <div className="tbl-wrap"><table className="ops-table">
          <thead><tr><th>광고주</th><th>담당</th><th>이번 달 계약</th><th>계약 수량 진행</th><th>다음 마감</th><th>광고비 소진</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="faint">{isAdmin ? "조건에 맞는 광고주가 없습니다." : "담당 광고주가 없습니다. '+ 새 광고주'로 만들거나 관리자에게 배정을 요청하세요."}</td></tr>}
            {rows.map((c) => {
              const t = totals(c.items);
              const next = c.items.filter((i) => itemState(i, period, mi.today) !== "done").sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
              const st = next ? itemState(next, period, mi.today) : null;
              const nv = c.channels.naver;
              const burn = nv?.contracted && nv.budget ? Math.min(1, (nv.spent ?? 0) / nv.budget) : null;
              return (
                <tr key={c.id}>
                  <td><Link href={`/admin/progress/${c.id}`} className="cname">{c.name}</Link><div className="faint">{[c.category, c.area].filter(Boolean).join(" · ")}</div></td>
                  <td>{c.staff.length === 0 ? <span className="badge warn">미배정</span> : c.staff.map((s) => <div key={s.id} className="nowrap">{s.name}{s.primary ? <span className="faint"> (주)</span> : ""}</div>)}</td>
                  <td>{c.contract ? <><span className="badge good">등록</span><div className="faint">{c.contract.amount != null ? won(c.contract.amount) : "금액 미입력"} · 파일 {c.files}</div></> : <Link href={`/admin/clients/${c.id}/contracts`} className="badge warn">미등록 · 등록하기</Link>}</td>
                  <td>
                    {t.quantity ? <>
                      <div className="num">{Math.round(t.rate * 100)}% <span className="faint">{t.done}/{t.quantity}</span></div>
                      <div className="bar thin pace" title={`기간 경과 ${mi.elapsed}/${mi.days}일`}><i style={{ width: `${t.rate * 100}%` }} /><s style={{ left: `${(mi.elapsed / mi.days) * 100}%` }} /></div>
                    </> : <span className="faint">계약 항목 없음</span>}
                  </td>
                  <td>{next ? <><span className={`badge ${{ late: "bad", risk: "warn", ok: "acc", done: "good" }[st!]}`}>{dday(daysLeft(next.dueOn, mi.today))}</span><div className="faint">{itemLabel(next)} {next.done}/{next.quantity}</div></> : t.quantity ? <span className="badge good">모두 완료</span> : <span className="faint">-</span>}</td>
                  <td>{burn != null ? <><div className="num">{Math.round(burn * 100)}%</div><div className="bar thin"><i style={{ width: `${burn * 100}%` }} /></div><div className="faint">{won(nv!.spent)} / {won(nv!.budget)}</div></>
                    : nv?.contracted ? <span className="faint">{nv.apiConnected ? `${won(nv.spent)} · 예산 미입력` : "API 연결 전"}</span> : <span className="faint">미집행</span>}</td>
                  <td className="r">
                    <div className="actions">
                      <Link className="btn sm" href={`/admin/progress/${c.id}`}>진행 현황</Link>
                      <Link className="btn sm" href={`/admin/clients/${c.id}`}>리포트</Link>
                      <Link className="btn sm" href={`/admin/clients/${c.id}/contracts`}>계약 · 견적</Link>
                      <Link className="btn sm" href={`/admin/clients/${c.id}/settings`}>설정</Link>
                      <IssueLinkButton clientId={c.id} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
