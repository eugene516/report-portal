// 리포트 내용 화면 (서버 컴포넌트) — 서울청명안과 샘플 페이지 형식
import Link from "next/link";
import type { ReportContent } from "@/lib/content";
import BlogKeywordEdit from "./BlogKeywordEdit";

const kst = (iso: string | null | undefined) => {
  if (!iso) return "-";
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString();
  return `${d.slice(5, 7)}.${d.slice(8, 10)} ${d.slice(11, 16)}`;
};
const fmt = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("ko-KR"));

function Rank({ v, collected }: { v: number | null | undefined; collected: boolean }) {
  if (!collected) return <span className="rank none">수집 전</span>;
  if (v == null) return <span className="rank out">순위 밖</span>;
  return <span className={`rank ${v <= 3 ? "top" : v <= 10 ? "mid" : ""}`}>{v}위</span>;
}
const Other = ({ o }: { o: { rank: number; url: string } | null }) =>
  o ? <div className="faint other"><a href={o.url} target="_blank" rel="noopener noreferrer">다른 글 {o.rank}위</a></div> : null;

// 네이버 메인 · 블로그 탭 중 더 높은 순위 (숫자가 작은 쪽)
const best = (a: number | null | undefined, b: number | null | undefined) => (a == null ? (b ?? null) : b == null ? a : Math.min(a, b));
const bestOther = (a: { rank: number; url: string } | null, b: { rank: number; url: string } | null) => (!a ? b : !b ? a : a.rank <= b.rank ? a : b);

const naverSearch = (k: string) => `https://search.naver.com/search.naver?query=${encodeURIComponent(k)}`;

// ── 블로그 · 콘텐츠 ──────────────────────────────────────────────────────
export function BlogSection({ c, tab, path, editable = false }: { c: ReportContent; tab: string; path: string; editable?: boolean }) {
  const extra = c.keywords.filter((k) => k.kind === "blog_extra");
  const etc = c.keywords.filter((k) => k.kind === "etc");
  const aeoKw = c.keywords.filter((k) => k.kind === "aeo");
  const tabs = [
    { id: "posts", label: `블로그 원고 ${c.blog.length}` },
    extra.length ? { id: "extra", label: `추가 노출 키워드 ${extra.length}` } : null,
    etc.length || aeoKw.length || c.aeo.length ? { id: "etc", label: `기타 · AEO 노출 ${etc.length + aeoKw.length}` } : null,
  ].filter((t): t is { id: string; label: string } => !!t);
  const on = tabs.find((t) => t.id === tab)?.id ?? "posts";
  const href = (id: string) => `${path}?period=${c.period}&tab=${id}`;
  return (
    <>
      <div className="tabs">{tabs.map((t) => <Link key={t.id} href={href(t.id)} className={t.id === on ? "on" : ""}>{t.label}</Link>)}</div>
      {on === "posts" && (
        <>
          <p className="muted">키워드를 네이버에서 검색했을 때 해당 원고가 노출되는 순위입니다(네이버 메인 · 블로그 탭 중 더 높은 순위). 제목을 누르면 블로그 글이 열립니다. &quot;다른 글&quot;은 해당 원고 대신 같은 블로그의 다른 글이 노출된 경우입니다.</p>
          <div className="card tbl-wrap"><table>
            <thead><tr><th>No</th><th>키워드</th><th>포스팅 제목</th><th className="r">순위</th><th>수집 시각</th></tr></thead>
            <tbody>
              {c.blog.length === 0 && <tr><td colSpan={5} className="faint">이 달에 발행된 블로그 원고가 없습니다.</td></tr>}
              {c.blog.map((b, i) => (
                <tr key={b.id}>
                  <td className="faint num">{i + 1}</td><td><b>{b.keyword}</b>{editable && <BlogKeywordEdit id={b.id} keyword={b.keyword} />}</td>
                  <td className="ellipsis"><a href={b.url} target="_blank" rel="noopener noreferrer" title={b.url}>{b.title}</a></td>
                  <td className="r"><Rank v={best(b.rank?.main, b.rank?.blogTab)} collected={!!b.rank} />{b.rank && best(b.rank.main, b.rank.blogTab) == null && <Other o={bestOther(b.rank.mainOther, b.rank.tabOther)} />}</td>
                  <td className="faint num">{kst(b.rank?.at)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
      {on === "extra" && (
        <div className="card tbl-wrap"><table>
          <thead><tr><th>No</th><th>키워드</th><th className="r">순위</th><th>수집 시각</th></tr></thead>
          <tbody>{extra.map((k, i) => (
            <tr key={k.keyword}><td className="faint num">{i + 1}</td><td><b>{k.keyword}</b></td>
              <td className="r"><Rank v={best(k.blogRank?.main, k.blogRank?.blogTab)} collected={!!k.blogRank} /></td>
              <td className="faint num">{kst(k.blogRank?.at)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {on === "etc" && (
        <div className="grid g-2">
          <KeywordList title="기타 노출" desc="통합검색의 블로그 외 영역에서 노출을 확인한 키워드" list={etc.map((k) => k.keyword)} />
          <KeywordList title="AEO 노출" desc="AI 답변형 검색에서 병원 언급을 확인한 키워드" list={aeoKw.map((k) => k.keyword)} />
        </div>
      )}
    </>
  );
}
// ── 홈페이지 칼럼 ─────────────────────────────────────────────────────────
export function ColumnSection({ c }: { c: ReportContent }) {
  return (
    <div className="card tbl-wrap"><table>
      <thead><tr><th>No</th><th>게시일</th><th>칼럼 제목</th><th></th></tr></thead>
      <tbody>
        {c.columns.length === 0 && <tr><td colSpan={4} className="faint">이 달에 등록된 칼럼이 없습니다.</td></tr>}
        {c.columns.map((x, i) => <tr key={x.url}><td className="faint num">{i + 1}</td><td className="num">{x.publishedOn ?? "-"}</td><td>{x.title}</td><td className="r"><a className="btn sm" href={x.url} target="_blank" rel="noopener noreferrer">홈페이지에서 보기</a></td></tr>)}
      </tbody>
    </table></div>
  );
}
function KeywordList({ title, desc, list }: { title: string; desc: string; list: string[] }) {
  return (
    <div className="card pad">
      <div className="card-h"><h3>{title}</h3><span className="faint">{list.length}개</span></div>
      <p className="faint" style={{ marginTop: 0 }}>{desc}</p>
      <ul className="list">{list.map((k) => <li key={k}><b>{k}</b><a className="btn sm" href={naverSearch(k)} target="_blank" rel="noopener noreferrer">네이버 검색</a></li>)}</ul>
    </div>
  );
}

// ── 플레이스 (엑셀 '네이버 지도 노출표' 형식) ──────────────────────────────
export function PlaceSection({ c, urls }: { c: ReportContent; urls: Map<string, string> }) {
  const rows = c.keywords.filter((k) => k.kind === "place");
  const ranked = rows.filter((r) => r.place?.rank != null).map((r) => r.place!.rank!);
  const last = rows.map((r) => r.place?.at).filter(Boolean).sort().at(-1);
  return (
    <>
      <p className="muted">지정 키워드를 네이버 메인에서 검색했을 때 플레이스 영역에서의 순위입니다(광고 제외). 캡쳐에서 검색 키워드와 해당 업체 항목을 빨간 박스로 표시했습니다.</p>
      {ranked.length > 0 && (
        <div className="row place-sum">
          <span className="badge good">1위 {ranked.filter((v) => v === 1).length}개</span>
          <span className="badge acc">3위 이내 {ranked.filter((v) => v <= 3).length}개</span>
          <span className="badge">평균 {(ranked.reduce((a, b) => a + b, 0) / ranked.length).toFixed(1)}위</span>
          <span className="badge">광고 노출 {rows.filter((r) => r.place?.adRank).length}개</span>
          <span className="faint">{kst(last)} 수집 · 총 {rows.length}개 키워드</span>
        </div>
      )}
      {rows.length === 0 && <div className="empty-state">등록된 플레이스 키워드가 없습니다.</div>}
      <div className="place-grid">
        {rows.map((r, i) => {
          const src = r.place?.capture ? urls.get(r.place.capture) : undefined;
          return (
            <figure key={r.keyword} className="place-card card">
              <figcaption>
                <div className="pk"><span className="faint num">{i + 1}</span><b>{r.keyword}</b>{r.important && <span className="badge warn" title="중점 관리 키워드">중점</span>}</div>
                <div className="row"><Rank v={r.place?.rank} collected={!!r.place} />{r.place?.page && r.place.rank != null && <span className="badge" title="플레이스 목록 페이지">{r.place.page}페이지</span>}{r.place?.adRank && <span className="badge acc">광고 {r.place.adRank}번째</span>}</div>
              </figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src ? <a href={src} target="_blank" rel="noopener noreferrer"><img loading="lazy" src={src} alt={`${r.keyword} 플레이스 노출 화면`} /></a> : <div className="noimg">{r.place ? "캡쳐 없음" : "수집 전"}</div>}
              <div className="pf faint"><span>{r.place ? `${kst(r.place.at)} 수집${r.place.page ? ` · 플레이스 ${r.place.page}페이지` : ""}` : ""}</span><a href={naverSearch(r.keyword)} target="_blank" rel="noopener noreferrer">네이버 검색</a></div>
            </figure>
          );
        })}
      </div>
    </>
  );
}

// ── 네이버 플레이스 광고 (플레이스 순위와 같은 키워드 · 같은 형식) ───────────────────────
export function PlaceAdsSection({ c, urls }: { c: ReportContent; urls: Map<string, string> }) {
  const rows = c.keywords.filter((k) => k.kind === "place");
  const shown = rows.filter((r) => r.place?.adRank != null);
  const last = rows.map((r) => r.place?.at).filter(Boolean).sort().at(-1);
  return (
    <>
      <p className="muted">플레이스 순위와 같은 키워드를 네이버 메인에서 검색했을 때 플레이스 영역의 <b>광고 자리</b>에 노출되는지 확인합니다. 캡쳐에서 검색 키워드와 광고 딱지가 붙은 해당 업체 항목을 빨간 박스로 표시했습니다.</p>
      {rows.length > 0 && (
        <div className="row place-sum">
          <span className="badge acc">광고 노출 {shown.length} / {rows.length}개 키워드</span>
          <span className="badge good">광고 1번째 {shown.filter((r) => r.place?.adRank === 1).length}개</span>
          <span className="faint">{kst(last)} 확인</span>
        </div>
      )}
      {rows.length === 0 && <div className="empty-state">등록된 플레이스 키워드가 없습니다.</div>}
      <div className="place-grid">
        {rows.map((r, i) => {
          const src = r.place?.adCapture ? urls.get(r.place.adCapture) : undefined;
          return (
            <figure key={r.keyword} className="place-card card">
              <figcaption>
                <div className="pk"><span className="faint num">{i + 1}</span><b>{r.keyword}</b>{r.important && <span className="badge warn">중점</span>}</div>
                <div className="row">{!r.place ? <span className="rank none">확인 전</span> : r.place.adRank != null ? <span className="rank top">광고 {r.place.adRank}번째</span> : <span className="rank out">광고 미노출</span>}</div>
              </figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src ? <a href={src} target="_blank" rel="noopener noreferrer"><img loading="lazy" src={src} alt={`${r.keyword} 플레이스 광고 노출 화면`} /></a> : <div className="noimg">{r.place ? (r.place.adRank != null ? "캡쳐 없음" : "광고 자리에 노출되지 않음") : "확인 전"}</div>}
              <div className="pf faint"><span>{r.place ? `${kst(r.place.at)} 확인` : ""}</span><a href={naverSearch(r.keyword)} target="_blank" rel="noopener noreferrer">네이버 검색</a></div>
            </figure>
          );
        })}
      </div>
    </>
  );
}

// ── 카페 바이럴 · 당근마켓 바이럴 (같은 형식, 게시처 이름만 다름) ─────────────────
export function CafeSection({ list, channel, urls }: { c: ReportContent; list: ReportContent["cafe"]; channel: "cafe" | "daangn"; urls: Map<string, string> }) {
  const L = channel === "cafe" ? { what: "카페", where: "카페명" } : { what: "당근 동네생활", where: "지역 · 게시판" };
  if (list.length === 0) return <div className="empty-state"><b>이 달에는 {L.what} 배포 내역이 없습니다.</b>지난 달 내용은 ‘지난 레포트 보기’에서 확인할 수 있습니다.</div>;
  const views = list.reduce((s, x) => s + (x.views ?? 0), 0);
  const deleted = list.filter((x) => x.status === "삭제됨").length;
  const status = (x: ReportContent["cafe"][number]) => x.status === "삭제됨" ? <span className="badge bad">삭제됨</span> : <span className="badge good">게시중</span>;
  return (
    <>
      <div className="grid g-kpi">
        <div className="card kpi static"><div className="label">{L.what} 배포</div><div className="value num">{list.length}<small>건</small></div></div>
        <div className="card kpi static"><div className="label">총 조회수</div><div className="value num">{fmt(views)}</div><div className="foot">{list[0].basis ?? ""} 기준</div></div>
        <div className="card kpi static"><div className="label">평균 조회수</div><div className="value num">{fmt(Math.round(views / list.length))}</div></div>
        <div className="card kpi static"><div className="label">현재 삭제</div><div className="value num">{deleted}<small>건</small></div></div>
      </div>
      <div className="card mt tbl-wrap"><table>
        <thead><tr><th>No</th><th>업로드일</th><th>{L.where}</th><th>게시글 링크</th><th className="r">조회</th><th className="r">댓글</th><th>현재 상태</th></tr></thead>
        <tbody>{list.map((x, i) => (
          <tr key={x.id}><td className="faint num">{i + 1}</td><td className="num">{x.postedOn ?? "-"}</td><td><b>{x.cafe}</b></td>
            <td><a href={x.url} target="_blank" rel="noopener noreferrer">{x.url.replace(/^https?:\/\//, "")}</a></td>
            <td className="r num">{fmt(x.views)}</td><td className="r num">{fmt(x.comments)}</td>
            <td>{status(x)}{x.capturedAt && <span className="faint"> {kst(x.capturedAt)} 확인</span>}</td></tr>
        ))}</tbody>
      </table></div>
      <h2 className="mt-l">{L.what} 게시글 캡쳐</h2>
      <p className="muted">배포한 게시글 화면입니다. 삭제된 글은 리포트 작성 당시의 캡쳐로 표시합니다.</p>
      <div className="place-grid">{list.map((x, i) => {
        const src = x.capture ? urls.get(x.capture) : undefined;
        return (
          <figure key={x.id} className="place-card card">
            <figcaption><div className="pk"><span className="faint num">{i + 1}</span><b>{x.cafe}</b></div><div className="row">{status(x)}</div></figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {src ? <a href={src} target="_blank" rel="noopener noreferrer"><img loading="lazy" src={src} alt={`${x.cafe} 게시글 캡쳐`} /></a> : <div className="noimg">캡쳐 없음</div>}
            <div className="pf faint"><span>{x.captureSource === "live" ? `${kst(x.capturedAt)} · 조회 ${fmt(x.currentViews)} · 댓글 ${fmt(x.currentComments)}` : x.captureSource === "report" ? "리포트 당시 캡쳐" : (x.postedOn ?? "")}</span><a href={x.url} target="_blank" rel="noopener noreferrer">원문</a></div>
          </figure>
        );
      })}</div>
    </>
  );
}

// ── SNS 카드뉴스 ─────────────────────────────────────────────────────────
const MEDIA_LABEL: Record<string, string> = { 카카오채널: "카카오 소식", 당근마켓: "당근 소식" };
const MEDIA_COLOR: Record<string, string> = { 인스타그램: "#d6249f", 당근마켓: "#ff6f0f", 카카오채널: "#e0b800" };
export function SnsSection({ c }: { c: ReportContent }) {
  if (c.cardnews.length === 0) return <div className="empty-state"><b>이 달에는 카드뉴스 배포 내역이 없습니다.</b></div>;
  return (
    <>
      <p className="muted">카드뉴스 1회차를 인스타그램 · 카카오 소식 · 당근 소식에 함께 배포합니다. 채널을 누르면 게시물로 이동합니다.</p>
      <div className="grid g-3">{c.cardnews.map((r) => (
        <div key={r.round} className="card round">
          <div className="row" style={{ justifyContent: "space-between" }}><h3>{r.round}회차</h3><span className="faint">{r.postedOn ?? `${r.links.length}개 채널`}</span></div>
          {r.topic && <div className="muted">{r.topic}</div>}
          <div className="links">{r.links.map((l) => (
            <a key={l.url} className="chip" href={l.url} target="_blank" rel="noopener noreferrer"><span className="dot" style={{ background: MEDIA_COLOR[l.media] ?? "#8a92a1" }} />{MEDIA_LABEL[l.media] ?? l.media}</a>
          ))}</div>
        </div>
      ))}</div>
    </>
  );
}
