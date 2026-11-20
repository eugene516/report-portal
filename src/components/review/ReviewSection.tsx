// 파일 검수 화면 (서버 컴포넌트) — 리포트 · 성과 집계와 분리된 별도 기능
// - 광고주(리포트 링크): 등록된 이메일로 로그인해야 목록 · 파일 · 검수 버튼이 보인다
// - 직원(staffView): 콘텐츠 등록 · 검수 요청 · 수정 요청 확인 · 수정본 등록 · 광고주 로그인 이메일 관리
import Link from "next/link";
import { notFound } from "next/navigation";
import { canEditReview, CLIENT_REVIEW_FROM, getReviewDetail, getReviewList, getReviewViewer, REVIEW_KINDS, REVIEW_STATUS, withFilesAndEvents } from "@/lib/review";
import { supabaseForStaff } from "@/lib/supabase/server";
import { ClientEmailLogin, ReviewLogout } from "./ReviewAuth";
import ReviewFiles from "./ReviewFiles";
import ReviewReplies, { topLevel } from "./ReviewReply";
import ReviewDecide from "./ReviewDecide";
import ReviewList from "./ReviewList";
import { ClientAccounts, ReviewCreate, ReviewStaffActions } from "./ReviewStaff";

const kst = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "-");
const ACTION: Record<string, string> = { request: "검수 요청", resubmit: "수정본 검수 요청", approve: "검수 완료", changes: "재검수 요청", edit: "원고 수정", reply: "답글" };
const Status = ({ s }: { s: string }) => <span className={`badge ${REVIEW_STATUS[s]?.badge ?? ""}`}>{REVIEW_STATUS[s]?.label ?? s}</span>;

export default async function ReviewSection({ clientId, clientName, base, itemId, period, kind, staffView, thisMonth, linkToken }: {
  clientId: string; clientName: string; base: string; itemId: string | null; period: string | undefined; kind?: string; staffView: boolean; thisMonth: string; linkToken: string | null;
}) {
  // 광고주 화면: 로그인 확인
  let viewerName: string | null = null;
  if (!staffView) {
    const v = await getReviewViewer(clientId);
    if (v.kind !== "client") return <ClientEmailLogin token={linkToken} clientName={clientName} other={v.kind === "other"} />;
    viewerName = v.name;
  }
  const head = viewerName && <div className="row review-head"><ReviewLogout name={viewerName} /></div>;

  // 상세
  if (itemId) {
    if (!/^[0-9a-f-]{36}$/.test(itemId)) notFound();
    const d = await getReviewDetail(itemId);
    if (!d || d.item.client_id !== clientId || (!staffView && d.item.period < CLIENT_REVIEW_FROM)) notFound();
    const { item, files, events } = d;
    const current = files.filter((f) => f.version === item.version);
    const next = files.filter((f) => f.version > item.version);
    const older = files.filter((f) => f.version < item.version);
    const lastChange = events.find((e) => e.action === "changes" && e.version === item.version);
    return (
      <>
        {head}
        <Link href={`${base}/review?${new URLSearchParams({ ...(item.period !== thisMonth ? { period: item.period } : {}), kind: item.kind })}`} className="faint back-link">‹ {REVIEW_KINDS[item.kind] ?? "파일 검수"} 목록</Link>
        <section className="card pad review-info">
          <div className="card-h"><h2>{item.title}</h2><Status s={item.status} /></div>
          <dl className="kv">
            <dt>유형</dt><dd>{REVIEW_KINDS[item.kind] ?? item.kind}</dd>
            <dt>대상 월</dt><dd>{item.period.replace("-", "년 ")}월</dd>
            <dt>검수 요청일</dt><dd>{kst(item.requested_at)}</dd>
            <dt>버전</dt><dd>{item.version}차 원고{item.approved_version ? ` · ${item.approved_version}차 검수 완료 (${kst(item.approved_at)})` : ""}</dd>
          </dl>
          {lastChange && <div className="notice mt-s">재검수 요청 ({lastChange.actor_name ?? "광고주"}, {kst(lastChange.created_at)}): {lastChange.comment}</div>}
        </section>
        {staffView && <ReviewStaffActions clientId={clientId} itemId={item.id} status={item.status} version={item.version} hasDraftFiles={current.length > 0} pendingNext={next.length} base={base} title={item.title} kind={item.kind} period={item.period} />}
        {staffView && next.length > 0 && <><h3 className="mt">{item.version + 1}차 수정본 (재검수 요청 전)</h3><ReviewFiles files={next} removable editable={canEditReview(item.kind, item.status, true)} /></>}
        <h3 className="mt">{item.status === "draft" ? "올린 파일" : `${item.version}차 원고`}</h3>
        <ReviewFiles files={current} removable={staffView} editable={canEditReview(item.kind, item.status, staffView)} />
        {!staffView && item.status === "pending" && <ReviewDecide itemId={item.id} version={item.version} title={item.title} />}
        {item.status === "approved" && !staffView && <div className="planned mt">이 콘텐츠는 검수 완료되었습니다.</div>}
        {item.status === "changes" && !staffView && <div className="planned mt">재검수 요청을 보냈습니다. 담당자가 수정본을 올리면 다시 검수할 수 있습니다.</div>}
        <section className="card pad mt">
          <h3>검수 기록</h3>
          <ul className="review-log">
            {events.length === 0 && <li className="faint">아직 기록이 없습니다.</li>}
            {/* 답글은 원래 코멘트 아래에 묶어서 보여 준다 */}
            {topLevel(events).map((e) => (
              <li key={e.id}><span className="num faint">{kst(e.created_at)}</span><b>{e.action === "approve" && e.actor_kind === "staff" ? "담당자 완료 처리" : ACTION[e.action] ?? e.action}</b><span className="faint">{e.version}차 · {e.actor_name ?? (e.actor_kind === "client" ? "광고주" : "담당자")}</span>{e.comment && <span className="review-comment">{e.comment}</span>}<ReviewReplies parent={e} events={events} staff={staffView} /></li>
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
  // 광고주 화면은 CLIENT_REVIEW_FROM 달부터: 그 전 달을 고르면 시작 월로 연다
  const from = staffView ? "" : CLIENT_REVIEW_FROM;
  const asked = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : thisMonth;
  const want = asked < from ? from : asked;
  const { items, periods: allPeriods } = await getReviewList(clientId, want);
  const periods = allPeriods.filter((p) => p >= from);
  const visible = staffView ? items : items.filter((i) => i.status !== "draft");
  const months = [...new Set([thisMonth < from ? from : thisMonth, ...periods])].sort().reverse();
  // 구분별 상자 메뉴: 블로그 · 홈페이지 칼럼 · 카드뉴스는 항상, 기타는 있을 때만. 상자를 누르면 그 구분의 목록만 보인다.
  const byKind = Object.keys(REVIEW_KINDS).map((k) => {
    const list = visible.filter((i) => i.kind === k);
    const sent = list.filter((i) => i.status !== "draft");
    return { k, total: list.length, sent: sent.length, done: sent.filter((i) => i.status === "approved").length,
      pending: list.filter((i) => i.status === "pending").length, changes: list.filter((i) => i.status === "changes").length, draft: list.length - sent.length };
  }).filter((x) => x.k !== "etc" || x.total > 0);
  const sel = kind && byKind.some((x) => x.k === kind) ? kind : null;
  const href = (k: string | null) => `${base}/review?${new URLSearchParams({ ...(want !== thisMonth ? { period: want } : {}), ...(k ? { kind: k } : {}) })}`;
  const accounts = staffView ? ((await (await supabaseForStaff()).from("client_users").select("user_id, name, email").eq("client_id", clientId).order("created_at")).data ?? []) : [];
  // 원고 번호 순 (10월블로그01 → 02 …)
  const rows = sel ? await withFilesAndEvents(visible.filter((i) => i.kind === sel).sort((a, b) => a.title.localeCompare(b.title, "ko", { numeric: true }))) : [];

  return (
    <>
      {head}
      {staffView && <ClientAccounts clientId={clientId} accounts={accounts} />}
      <div className="row period-bar review-bar">
        <form className="row" method="get">
          <label className="faint" htmlFor="rv-period">대상 월</label>
          <select id="rv-period" name="period" defaultValue={want}>{months.map((m) => <option key={m} value={m}>{m.replace("-", "년 ")}월</option>)}</select>
          {sel && <input type="hidden" name="kind" value={sel} />}
          <button className="btn sm">보기</button>
        </form>
        {staffView && <ReviewCreate clientId={clientId} period={want} />}
      </div>
      <div className={`review-kinds${sel ? " compact" : ""}`}>
        {byKind.map((x) => (
          <Link key={x.k} href={href(sel === x.k ? null : x.k)} className={`card kpi${sel === x.k ? " active" : ""}`} aria-current={sel === x.k ? "page" : undefined}>
            <div className="label">{REVIEW_KINDS[x.k]}</div>
            <div className="value num">{x.pending}<small>건 검수 대기 /</small> {x.done}<small>건 검수 완료</small></div>
            <div className="foot">
              {x.total === 0 ? "등록된 콘텐츠 없음" : [x.changes && `재검수 요청 ${x.changes}`, staffView && x.draft && `작성 중 ${x.draft}`].filter(Boolean).join(" · ") || (x.pending ? `검수 요청 ${x.sent}건` : "모두 검수 완료")}
            </div>
          </Link>
        ))}
      </div>
      {!sel ? <div className="empty-state mt">{visible.length === 0 ? (staffView ? "이 달에 등록한 검수 콘텐츠가 없습니다. ‘+ 검수 콘텐츠 등록’으로 시작하세요." : "이 달에 검수할 콘텐츠가 없습니다.") : "위에서 구분을 눌러 목록을 확인하세요."}</div>
        : rows.length === 0 ? <div className="empty-state mt">이 달에 등록된 {REVIEW_KINDS[sel]} 콘텐츠가 없습니다.</div>
        : <>
            <div className="row review-list-h mt"><h3>{REVIEW_KINDS[sel]} <span className="faint">{rows.length}건</span></h3><Link href={href(null)} className="faint">구분 목록으로</Link></div>
            <ReviewList rows={rows} staff={staffView} base={base} />
          </>}
    </>
  );
}
