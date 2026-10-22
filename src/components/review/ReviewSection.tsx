// 파일 검수 화면 (서버 컴포넌트) — 리포트 · 성과 집계와 분리된 별도 기능
// - 광고주(리포트 링크 · 미리보기): 광고주 계정으로 로그인해야 목록 · 파일 · 검수 버튼이 보인다
// - 직원(staffView): 콘텐츠 등록 · 검수 요청 · 수정 요청 확인 · 수정본 등록 · 광고주 계정 관리
import Link from "next/link";
import { notFound } from "next/navigation";
import { getReviewDetail, getReviewList, getReviewViewer, REVIEW_KINDS, REVIEW_STATUS, type ReviewItem } from "@/lib/review";
import { supabaseForStaff } from "@/lib/supabase/server";
import { ReviewChangePassword, ReviewLogin, ReviewLogout } from "./ReviewAuth";
import ReviewFiles from "./ReviewFiles";
import ReviewDecide from "./ReviewDecide";
import { ClientAccounts, ReviewCreate, ReviewStaffActions } from "./ReviewStaff";

const kst = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "-");
const ACTION: Record<string, string> = { request: "검수 요청", resubmit: "수정본 재검수 요청", approve: "검수 완료", changes: "수정 요청" };
const Status = ({ s }: { s: string }) => <span className={`badge ${REVIEW_STATUS[s]?.badge ?? ""}`}>{REVIEW_STATUS[s]?.label ?? s}</span>;

export default async function ReviewSection({ clientId, clientName, base, itemId, period, staffView, thisMonth, siteLogin }: {
  clientId: string; clientName: string; base: string; itemId: string | null; period: string | undefined; staffView: boolean; thisMonth: string; siteLogin: string;
}) {
  // 광고주 화면: 로그인 확인
  let viewerName: string | null = null;
  if (!staffView) {
    const v = await getReviewViewer(clientId);
    if (v.kind !== "client") return <ReviewLogin clientName={clientName} other={v.kind === "other"} />;
    if (v.mustChange) return <ReviewChangePassword />;
    viewerName = v.name;
  }
  const head = viewerName && <div className="row review-head"><ReviewLogout name={viewerName} /></div>;

  // 상세
  if (itemId) {
    if (!/^[0-9a-f-]{36}$/.test(itemId)) notFound();
    const d = await getReviewDetail(itemId);
    if (!d || d.item.client_id !== clientId) notFound();
    const { item, files, events } = d;
    const current = files.filter((f) => f.version === item.version);
    const next = files.filter((f) => f.version > item.version);
    const older = files.filter((f) => f.version < item.version);
    const lastChange = events.find((e) => e.action === "changes" && e.version === item.version);
    return (
      <>
        {head}
        <Link href={`${base}/review${item.period !== thisMonth ? `?period=${item.period}` : ""}`} className="faint back-link">‹ 파일 검수 목록</Link>
        <section className="card pad review-info">
          <div className="card-h"><h2>{item.title}</h2><Status s={item.status} /></div>
          <dl className="kv">
            <dt>유형</dt><dd>{REVIEW_KINDS[item.kind] ?? item.kind}</dd>
            <dt>대상 월</dt><dd>{item.period.replace("-", "년 ")}월</dd>
            <dt>검수 요청일</dt><dd>{kst(item.requested_at)}</dd>
            <dt>버전</dt><dd>{item.version}차 원고{item.approved_version ? ` · ${item.approved_version}차 검수 완료 (${kst(item.approved_at)})` : ""}</dd>
          </dl>
          {lastChange && <div className="notice mt-s">수정 요청 ({lastChange.actor_name ?? "광고주"}, {kst(lastChange.created_at)}): {lastChange.comment}</div>}
        </section>
        {staffView && <ReviewStaffActions clientId={clientId} itemId={item.id} status={item.status} version={item.version} hasDraftFiles={current.length > 0} pendingNext={next.length} base={base} />}
        {staffView && next.length > 0 && <><h3 className="mt">{item.version + 1}차 수정본 (재검수 요청 전)</h3><ReviewFiles files={next} /></>}
        <h3 className="mt">{item.status === "draft" ? "올린 파일" : `${item.version}차 원고`}</h3>
        <ReviewFiles files={current} />
        {!staffView && item.status === "pending" && <ReviewDecide itemId={item.id} version={item.version} title={item.title} />}
        {item.status === "approved" && !staffView && <div className="planned mt">이 콘텐츠는 검수 완료되었습니다.</div>}
        {item.status === "changes" && !staffView && <div className="planned mt">수정 요청을 보냈습니다. 담당자가 수정본을 올리면 다시 검수할 수 있습니다.</div>}
        <section className="card pad mt">
          <h3>검수 기록</h3>
          <ul className="review-log">
            {events.length === 0 && <li className="faint">아직 기록이 없습니다.</li>}
            {events.map((e) => (
              <li key={e.id}><span className="num faint">{kst(e.created_at)}</span><b>{e.action === "approve" && e.actor_kind === "staff" ? "담당자 완료 처리" : ACTION[e.action] ?? e.action}</b><span className="faint">{e.version}차 · {e.actor_name ?? (e.actor_kind === "client" ? "광고주" : "담당자")}</span>{e.comment && <span className="review-comment">{e.comment}</span>}</li>
            ))}
          </ul>
          {older.length > 0 && (
            <details className="mt-s"><summary className="faint">이전 버전 파일 {older.length}개</summary><ReviewFiles files={older} /></details>
          )}
        </section>
      </>
    );
  }

  // 목록
  const want = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : thisMonth;
  const { items, periods } = await getReviewList(clientId, want);
  const visible = staffView ? items : items.filter((i) => i.status !== "draft");
  const months = [...new Set([thisMonth, ...periods])].sort().reverse();
  const byKind = Object.keys(REVIEW_KINDS).map((k) => {
    const list = visible.filter((i) => i.kind === k && i.status !== "draft");
    return { k, total: list.length, done: list.filter((i) => i.status === "approved").length };
  }).filter((x) => x.total > 0);
  const accounts = staffView ? ((await (await supabaseForStaff()).from("client_users").select("user_id, name, email, must_change_password").eq("client_id", clientId).order("created_at")).data ?? []) : [];
  const action = (i: ReviewItem) => (!staffView && i.status === "pending" ? "검수하기" : "보기");

  return (
    <>
      {head}
      {staffView && <ClientAccounts clientId={clientId} accounts={accounts} loginUrl={siteLogin} />}
      <div className="row period-bar review-bar">
        <form className="row" method="get">
          <label className="faint" htmlFor="rv-period">대상 월</label>
          <select id="rv-period" name="period" defaultValue={want}>{months.map((m) => <option key={m} value={m}>{m.replace("-", "년 ")}월</option>)}</select>
          <button className="btn sm">보기</button>
        </form>
        {staffView && <ReviewCreate clientId={clientId} period={want} />}
      </div>
      {byKind.length > 0 && (
        <div className="review-kinds">
          {byKind.map((x) => (
            <div key={x.k} className="card kpi static">
              <div className="label">{REVIEW_KINDS[x.k]}</div>
              <div className="value num">{x.done}<small>/ {x.total}건</small></div>
              <div className="foot">{x.total}건 중 {x.done}건 검수 완료</div>
            </div>
          ))}
        </div>
      )}
      {visible.length === 0 ? <div className="empty-state mt">{staffView ? "이 달에 등록한 검수 콘텐츠가 없습니다. ‘+ 검수 콘텐츠 등록’으로 시작하세요." : "이 달에 검수할 콘텐츠가 없습니다."}</div> : (
        <div className="card tbl-wrap mt"><table className="rtable review-table">
          <thead><tr><th>콘텐츠 제목</th><th>유형</th><th>검수 상태</th><th>요청일</th><th></th></tr></thead>
          <tbody>{visible.map((i) => (
            <tr key={i.id}>
              <td><Link href={`${base}/review/${i.id}`} className="cname">{i.title}</Link>{i.version > 1 && <span className="faint"> · {i.version}차</span>}</td>
              <td data-label="유형">{REVIEW_KINDS[i.kind] ?? i.kind}</td>
              <td data-label="검수 상태"><Status s={i.status} /></td>
              <td data-label="요청일" className="num faint">{kst(i.requested_at)}</td>
              <td className="r"><Link className={`btn sm ${action(i) === "검수하기" ? "primary" : ""}`} href={`${base}/review/${i.id}`}>{action(i)}</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
