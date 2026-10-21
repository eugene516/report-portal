// 메인 대시보드 (prototype/index.html 운영 대시보드 형식)
// - 오너·관리자: 전체 광고주 + 담당 직원별 필터 + 직원별 담당 현황
// - 직원: 본인 담당 광고주만 + 상단 탭(전체보기 | 광고주별)
// 어떤 광고주를 볼 수 있는지는 DB 함수(dashboard_overview)가 호출자 권한으로 결정한다.
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { buildAlerts, getOverview, getStaffOverview, type ClientRow } from "@/lib/dashboard";
import { currentPeriod } from "@/lib/content";
import IssueLinkButton from "./IssueLinkButton";

export const metadata = { title: "운영 대시보드 · 리포트 포털" };
export const dynamic = "force-dynamic";

const kst = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ").replace("-", ".") : "-");
const pct = (a: number, b: number) => (b ? Math.min(100, (a / b) * 100) : 0);
const ROLE: Record<string, string> = { owner: "오너", admin: "관리자", staff: "직원" };

export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireStaff();
  const sp = await searchParams;
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : currentPeriod();
  const isAdmin = me.role === "owner" || me.role === "admin";
  const [all, staffList] = await Promise.all([getOverview(period), isAdmin ? getStaffOverview() : Promise.resolve([])]);

  // 필터: 관리자 = 담당 직원별, 직원 = 광고주 탭
  const staffFilter = isAdmin ? sp.staff : undefined;
  const clientTab = !isAdmin ? sp.client : undefined;
  const q = (sp.q ?? "").trim();
  let rows = all;
  if (staffFilter) rows = rows.filter((c) => c.staff.some((s) => s.id === staffFilter));
  if (q) rows = rows.filter((c) => c.name.includes(q));
  const selected = clientTab ? all.find((c) => c.id === clientTab) : undefined;
  if (selected) rows = [selected];

  const alerts = buildAlerts(rows, period);
  const sum = (k: keyof ClientRow) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const blogTarget = rows.reduce((s, r) => s + (r.services.blog ?? 0), 0);
  const placeTotal = sum("place_total"), placeTop3 = sum("place_top3");
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ period, staff: staffFilter, client: clientTab, q: q || undefined, ...extra })) if (v) p.set(k, v);
    return `/admin?${p.toString()}`;
  };

  return (
    <div className="ops">
      {sp.denied && <div className="notice">관리자만 사용할 수 있는 메뉴입니다.</div>}
      <header className="ops-head-in">
        <div>
          <div className="faint">믿는구석 · {isAdmin ? `${ROLE[me.role]} 화면 (전체 광고주)` : "내 담당 광고주"}</div>
          <h1>리포트 운영 대시보드</h1>
        </div>
        <div className="row">
          <form className="row" method="get">
            {staffFilter && <input type="hidden" name="staff" value={staffFilter} />}
            <label className="faint" htmlFor="period">보고 월</label>
            <input id="period" type="month" name="period" defaultValue={period} className="search date" />
            <input type="search" name="q" defaultValue={q} placeholder="광고주 검색" className="search" />
            <button className="btn sm">적용</button>
          </form>
          <Link href="/admin/clients/new" className="btn primary">+ 새 광고주</Link>
          {isAdmin && <Link href="/admin/staff" className="btn">직원 · 권한 관리</Link>}
        </div>
      </header>

      {/* 상단 탭 */}
      {isAdmin ? (
        <div className="seg mt">
          <Link href={qs({ staff: undefined })} className={!staffFilter ? "on" : ""}>전체 담당</Link>
          {staffList.filter((s) => s.clients.length > 0).map((s) => (
            <Link key={s.id} href={qs({ staff: s.id })} className={staffFilter === s.id ? "on" : ""}>{s.name}</Link>
          ))}
        </div>
      ) : (
        <div className="seg mt">
          <Link href={qs({ client: undefined })} className={!clientTab ? "on" : ""}>전체보기</Link>
          {all.map((c) => <Link key={c.id} href={qs({ client: c.id })} className={clientTab === c.id ? "on" : ""}>{c.name}</Link>)}
        </div>
      )}

      {/* 요약 지표 */}
      <div className="grid g-kpi5 mt">
        <div className="card kpi static"><div className="label">{isAdmin ? "운영 광고주" : "담당 광고주"}</div><div className="value num">{rows.length}<small>곳</small></div><div className="foot">{period.replace("-", "년 ")}월 기준</div></div>
        <div className="card kpi static"><div className="label">블로그 발행</div><div className="value num">{sum("blog_count")}<small>{blogTarget ? `/ ${blogTarget}건` : "건"}</small></div>{blogTarget > 0 && <div className="bar mt-s"><i style={{ width: `${pct(sum("blog_count"), blogTarget)}%` }} /></div>}</div>
        <div className="card kpi static"><div className="label">블로그 5위 이내</div><div className="value num">{sum("blog_top5")}<small>/ {sum("blog_count")}건</small></div><div className="foot">네이버 메인 · 블로그 탭 기준</div></div>
        <div className="card kpi static"><div className="label">플레이스 Top 3</div><div className="value num">{placeTop3}<small>/ {placeTotal}개</small></div><div className="foot">최근 수집 기준</div></div>
        <div className={`card kpi static ${alerts.some((a) => a.level === "high") ? "alert" : ""}`}><div className="label">확인 필요</div><div className="value num">{alerts.length}<small>건</small></div><div className="foot">긴급 {alerts.filter((a) => a.level === "high").length} · 주의 {alerts.filter((a) => a.level === "mid").length}</div></div>
      </div>

      <div className="ops-main mt">
        <section className="card">
          <div className="card-h pad-h"><h2>{selected ? selected.name : "광고주 현황"}</h2><span className="faint">리포트 열기 = 직원 화면 · 광고주 링크 = 광고주에게 보내는 주소</span></div>
          <div className="tbl-wrap"><table className="ops-table">
            <thead><tr><th>광고주</th><th>담당</th><th>블로그 발행</th><th className="r">5위 이내</th><th>플레이스</th><th>카페 · SNS</th><th>온라인 광고</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="faint">{isAdmin ? "등록된 광고주가 없습니다." : "담당 광고주가 없습니다. '+ 새 광고주'로 만들거나 관리자에게 배정을 요청하세요."}</td></tr>}
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/admin/clients/${c.id}?period=${period}`} className="cname">{c.name}</Link><div className="faint">{[c.category, c.area].filter(Boolean).join(" · ")}</div></td>
                  <td>{c.staff.length === 0 ? <span className="badge warn">미배정</span> : c.staff.map((s) => <div key={s.id} className="nowrap">{s.name}{s.primary ? <span className="faint"> (주)</span> : ""}</div>)}</td>
                  <td>{"blog" in c.services ? <><div className="num">{c.blog_count}<span className="faint">{c.services.blog ? ` / ${c.services.blog}` : ""}</span></div>{c.services.blog ? <div className="bar thin"><i style={{ width: `${pct(c.blog_count, c.services.blog)}%` }} /></div> : null}</> : <span className="faint">계약 없음</span>}</td>
                  <td className="r num">{"blog" in c.services ? <>{c.blog_top5}<span className="faint">/{c.blog_count}</span></> : "-"}</td>
                  <td>{"place" in c.services ? <><div className="num">평균 {c.place_avg ?? "-"}위</div><div className="faint">Top3 {c.place_top3}/{c.place_total} · {kst(c.place_last_at)}</div></> : <span className="faint">계약 없음</span>}</td>
                  <td>
                    {"cafe" in c.services && <div className="num">카페 {c.cafe_count}건{c.cafe_deleted > 0 && <span className="badge bad"> 삭제 {c.cafe_deleted}</span>}</div>}
                    {"cardnews" in c.services && <div className="faint">카드뉴스 {c.card_rounds}회차</div>}
                    {!("cafe" in c.services) && !("cardnews" in c.services) && <span className="faint">-</span>}
                  </td>
                  <td>{(["naver", "daangn", "kakao"] as const).map((k) => {
                    const s = c.channels[k]; const label = { naver: "네이버", daangn: "당근", kakao: "카카오" }[k];
                    if (!s?.contracted) return null;
                    return <span key={k} className={`badge ${s.apiConnected ? "good" : "warn"}`}>{label}{s.apiConnected ? "" : " 연결 전"}</span>;
                  })}{!Object.values(c.channels).some((s) => s.contracted) && <span className="faint">미집행</span>}</td>
                  <td className="r">
                    <div className="actions">
                      <Link className="btn sm" href={`/admin/clients/${c.id}?period=${period}`}>리포트 열기</Link>
                      <Link className="btn sm" href={`/admin/clients/${c.id}/settings`}>설정</Link>
                      <IssueLinkButton clientId={c.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        <section className="card">
          <div className="card-h pad-h"><h2>확인 필요</h2><span className="faint">{alerts.length}건</span></div>
          <ul className="alerts">
            {alerts.length === 0 && <li className="faint pad-x">확인할 항목이 없습니다.</li>}
            {alerts.slice(0, 40).map((a, i) => (
              <li key={i}><Link href={a.href}><span className={`lv ${a.level}`} /><span className="t"><b>{a.client.name}</b><span>{a.text}</span></span></Link></li>
            ))}
          </ul>
        </section>
      </div>

      {isAdmin && (
        <section className="card mt-l">
          <div className="card-h pad-h"><h2>직원별 담당 현황</h2><Link href="/admin/staff" className="btn sm">직원 · 권한 관리</Link></div>
          <div className="tbl-wrap"><table className="ops-table">
            <thead><tr><th>직원</th><th>권한</th><th className="r">담당 광고주</th><th>담당 목록</th></tr></thead>
            <tbody>{staffList.map((s) => (
              <tr key={s.id}>
                <td><Link href={qs({ staff: s.id })} className="cname">{s.name}</Link><div className="faint">{s.email}</div></td>
                <td><span className={`badge ${s.role === "owner" ? "acc" : s.role === "admin" ? "good" : ""}`}>{ROLE[s.role]}</span></td>
                <td className="r num">{s.clients.length}</td>
                <td>{s.clients.length === 0 ? <span className="faint">-</span> : s.clients.map((c) => <span key={c.id} className="chip-s">{c.name}{c.primary ? " (주)" : ""}</span>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
