// 광고주 리포트 페이지 본문 (직원 경로·광고주 경로 공용, 서버 컴포넌트)
import Link from "next/link";
import { notFound } from "next/navigation";
import { basePath, getClientSummary, getNaverReport, getNaverTopKeywords, resolveKeywordWindow, resolvePeriod, type ClientSummary, type ReportCtx } from "@/lib/report";
import { captureUrls, currentPeriod, getContentForRequest, getHistory, SERVICE_LABELS, type HistoryMonth, type ReportContent } from "@/lib/content";
import ReportShell, { AD_CHANNELS, isActiveChannel, isContracted, MENUS, visibleMenus, type AdChannelId } from "./ReportShell";
import NaverAdsView from "./NaverAdsView";
import { BlogSection, CafeSection, ColumnSection, PlaceSection, SnsSection } from "./ContentSections";
import ContractsSection from "./ContractsSection";
import SectionTools, { type SectionKind } from "./SectionTools";
import AdContractButton from "./AdContractButton";
import { getMonthOverview, monthInfo } from "@/lib/month";
import { Donut } from "./charts";

// 받침 있으면 "은", 없으면 "는" (예: 당근마켓 바이럴은, 홈페이지 칼럼은, SNS 카드뉴스는)
const eunNeun = (w: string) => {
  const c = w.charCodeAt(w.length - 1);
  return `${w}${c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? "은" : "는"}`;
};

const SECTION_KIND: Partial<Record<string, SectionKind>> = { blog: "blog", column: "column", cafe: "cafe", daangn: "daangn", sns: "cardnews" };

// 미집행 메뉴라도 등록된 내용이 있으면 보여준다
function hasContent(c: ReportContent, key: string) {
  if (key === "blog") return c.blog.length > 0;
  if (key === "column") return c.columns.length > 0;
  if (key === "cafe" || key === "daangn") return c.cafe.some((x) => (x.channel ?? "cafe") === key);
  if (key === "sns") return c.cardnews.length > 0;
  return false;
}

// 직원 경로 전용: 이 메뉴의 이번 달 계약 수량(견적 + 추가) 요약과 입력 도구
async function StaffSectionTools({ clientId, period, kind, contracted, content }: { clientId: string; period: string; kind: SectionKind; contracted: boolean; content: ReportContent }) {
  const [row] = await getMonthOverview(period, clientId);
  const items = (row?.items ?? []).filter((i) => i.service === kind);
  const open = items.filter((i) => i.done < i.quantity).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const summary = items.length ? {
    quantity: items.reduce((s, i) => s + i.quantity, 0),
    extra: items.filter((i) => i.extra).reduce((s, i) => s + i.quantity, 0),
    done: items.reduce((s, i) => s + Math.min(i.done, i.quantity), 0),
    dueOn: open[0]?.dueOn ?? null,
  } : null;
  const nextRound = Math.max(0, ...content.cardnews.map((r) => r.round)) + 1;
  return <SectionTools clientId={clientId} period={period} kind={kind} contracted={contracted} lastDay={monthInfo(period).last} nextRound={nextRound} summary={summary} />;
}

export default async function ReportPage({
  ctx, section, searchParams, staffTools,
}: { ctx: ReportCtx; section: string[]; searchParams: Record<string, string | undefined>; staffTools: boolean }) {
  // 광고주 정보와 리포트 내용은 서로 기다릴 필요가 없어 동시에 불러온다
  const [client, content] = await Promise.all([getClientSummary(ctx), getContentForRequest(ctx, searchParams.period)]);
  if (!client || !content) notFound();   // 틀린 링크·권한 없음: 존재 여부를 구분하지 않는다
  const base = basePath(ctx);
  const key = section.join("/");
  const services = Object.keys(content.services);
  const monthLabel = `${content.period.replace("-", "년 ")}월`;

  let title: string;
  let body: React.ReactNode;
  if (section[0] === "ads") {
    const ch = AD_CHANNELS.find((c) => c.id === section[1]);
    if (!ch || section.length !== 2) notFound();
    title = ch.label;
    body = await adsBody(ctx, client, ch.id, ch.label, `${base}/ads/${ch.id}`, searchParams);
  } else if (key === "history") {
    title = "지난 레포트 보기";
    body = <HistorySection months={await getHistory(ctx)} thisMonth={currentPeriod()} base={base} services={services} />;
  } else if (key === "contracts") {
    // 직원 경로에서만 열린다 (광고주 링크로는 이 주소가 없다)
    if (ctx.mode !== "staff" || !staffTools) notFound();
    title = "계약 · 견적 관리";
    body = <ContractsSection clientId={ctx.clientId} requested={searchParams.period} />;
  } else {
    const menu = MENUS.find((m) => m.id === key);
    if (!menu || !visibleMenus(services).includes(menu)) notFound();   // 고정 메뉴가 아니고 계약하지 않은 항목(플레이스)의 주소는 열리지 않는다
    title = menu.label;
    let inner: React.ReactNode;
    if (key === "") inner = <Dashboard client={client} content={content} base={base} />;
    else if (key === "blog") inner = <BlogSection c={content} tab={searchParams.tab ?? "posts"} path={`${base}/blog`} />;
    else if (key === "column") inner = <ColumnSection c={content} />;
    else if (key === "place") inner = <PlaceSection c={content} urls={await captureUrls(ctx, content.keywords.map((k) => k.place?.capture ?? null))} />;
    else if (key === "cafe" || key === "daangn") {
      const list = content.cafe.filter((x) => (x.channel ?? "cafe") === key);
      inner = <CafeSection c={content} list={list} channel={key} urls={await captureUrls(ctx, list.map((x) => x.capture))} />;
    } else inner = <SnsSection c={content} />;
    const kind = SECTION_KIND[key];
    const contracted = isContracted(services, menu.svc);
    body = (
      <>
        {!contracted && (
          <div className="empty-state off-state off-banner">
            <b>{eunNeun(menu.label)} 이번 계약에 포함되지 않은 미집행 항목입니다.</b>
            {ctx.mode === "staff" ? "중간에 계약되면 아래 ‘+ 추가 계약’으로 수량과 마감일을 등록하세요." : "진행이 시작되면 이곳에 내용이 표시됩니다."}
          </div>
        )}
        {kind && ctx.mode === "staff" && staffTools && <StaffSectionTools clientId={ctx.clientId} period={content.period} kind={kind} contracted={contracted} content={content} />}
        {(contracted || hasContent(content, key)) && inner}
      </>
    );
  }

  return (
    <ReportShell client={client} base={base} section={section} title={title}
      eyebrow={`${client.name} · ${section[0] === "ads" ? "온라인 광고" : key === "history" || key === "contracts" ? "월별 관리" : `${monthLabel} 마케팅 리포트`}`}
      staffTools={staffTools} services={services} period={content.period} thisMonth={currentPeriod()}>
      {body}
    </ReportShell>
  );
}

async function adsBody(ctx: ReportCtx, client: ClientSummary, ch: AdChannelId, label: string, path: string, sp: Record<string, string | undefined>) {
  const state = client.channels[ch];
  if (!state?.contracted) {
    const others = AD_CHANNELS.filter((c) => c.id !== ch && isActiveChannel(client, c.id));
    return (
      <div className="empty-state off-state">
        <b>{eunNeun(label)} 집행되지 않는 광고입니다.</b>
        계약된 광고가 아니어서 표시할 성과가 없습니다.
        {ctx.mode === "staff" && <div className="row mt" style={{ justifyContent: "center" }}><AdContractButton clientId={ctx.clientId} channel={ch} label={label} /></div>}
        {others.length > 0 && (
          <div className="row mt" style={{ justifyContent: "center" }}>
            {others.map((o) => <Link key={o.id} className="btn" href={path.replace(/\/ads\/[^/]+$/, `/ads/${o.id}`)}>{o.label} 성과 보기</Link>)}
          </div>
        )}
      </div>
    );
  }
  if (!isActiveChannel(client, ch) || ch !== "naver") {
    return (
      <div className="empty-state off-state">
        <b>{label} 성과 연결을 준비하고 있습니다.</b>
        계약된 채널이며, 광고 계정 연결이 끝나면 매일 오전 9시에 성과가 자동으로 반영됩니다.
      </div>
    );
  }
  const period = resolvePeriod(sp);
  const kwWindow = resolveKeywordWindow(sp.kwm, period.to);
  const [data, topKeywords] = await Promise.all([getNaverReport(ctx, period.from, period.to), getNaverTopKeywords(ctx, kwWindow)]);
  if (!data) return <div className="notice">성과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>;
  if (data.notContracted) return <div className="empty-state off-state"><b>{eunNeun(label)} 집행되지 않는 광고입니다.</b></div>;
  // 담당자 코멘트: 직원 화면에서만 편집, 광고주 링크 화면은 읽기 전용
  const note = ctx.mode === "staff" ? { editable: true as const, clientId: ctx.clientId, period: period.to.slice(0, 7) } : { editable: false as const };
  const kwSort = sp.kwsort === "impressions" || sp.kwsort === "cost" ? sp.kwsort : "clicks";
  return <NaverAdsView data={data} period={period} path={path} note={note} top={{ window: kwWindow, keywords: topKeywords, sort: kwSort }} query={sp} />;
}

function Dashboard({ client, content, base }: { client: ClientSummary; content: ReportContent; base: string }) {
  const s = content.services;
  const past = content.period !== currentPeriod();
  const q = past ? `?period=${content.period}` : "";
  const top5 = content.blog.filter((b) => (b.rank?.main ?? 99) <= 5 || (b.rank?.blogTab ?? 99) <= 5).length;
  const place = content.keywords.filter((k) => k.kind === "place");
  const placeRanks = place.map((p) => p.place?.rank).filter((v): v is number => v != null);
  // 수량 계약 항목: 도넛 (계약 수량 대비 진행)
  // 고정 항목: 계약하지 않았으면 미집행으로 표시
  const cafe = content.cafe.filter((x) => (x.channel ?? "cafe") === "cafe");
  const daangn = content.cafe.filter((x) => x.channel === "daangn");
  const views = (l: typeof cafe) => l.reduce((a, x) => a + (x.views ?? 0), 0).toLocaleString("ko-KR");
  const cards: { label: string; on: boolean; done: number; target: number | null; unit: string; foot: string; href: string }[] = [
    { label: "블로그 발행", on: !!s.blog, done: content.blog.length, target: s.blog?.target ?? null, unit: "건", foot: `5위 이내 ${top5}건`, href: `${base}/blog${q}` },
    { label: "홈페이지 칼럼", on: !!s.column, done: content.columns.length, target: s.column?.target ?? null, unit: "건", foot: "SEO · AEO용 칼럼", href: `${base}/column${q}` },
    { label: "카페 바이럴", on: !!s.cafe, done: cafe.filter((x) => x.status !== "삭제됨").length, target: s.cafe?.target ?? null, unit: "건", foot: `조회 ${views(cafe)}`, href: `${base}/cafe${q}` },
    { label: "당근마켓 바이럴", on: !!s.daangn, done: daangn.filter((x) => x.status !== "삭제됨").length, target: s.daangn?.target ?? null, unit: "건", foot: `조회 ${views(daangn)}`, href: `${base}/daangn${q}` },
    { label: "SNS 카드뉴스", on: !!s.cardnews, done: content.cardnews.length, target: s.cardnews?.target ?? null, unit: "회차", foot: `인스타·카카오·당근 소식 ${content.cardnews.reduce((a, r) => a + r.links.length, 0)}개`, href: `${base}/sns${q}` },
  ];
  return (
    <>
      <div className="grid g-donut">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className={`card kpi donut-card ${c.on || c.done ? "" : "empty"}`}>
            {!c.on && !c.done ? <><div className="label">{c.label}</div><div className="value">미집행</div><div className="foot">계약에 포함되지 않음</div></>
              : c.target ? <Donut done={c.done} total={c.target} label={c.label} sub={c.foot} size={104} />
              : <><div className="label">{c.label}</div><div className="value num">{c.done}<small>{c.unit}</small></div><div className="foot">{c.foot}</div></>}
          </Link>
        ))}
        {s.place && (
          <Link href={`${base}/place${q}`} className="card kpi donut-card">
            <Donut done={placeRanks.filter((v) => v <= 3).length} total={place.length} label="플레이스 Top 3" sub={placeRanks.length ? `평균 ${(placeRanks.reduce((a, b) => a + b, 0) / placeRanks.length).toFixed(1)}위` : "수집 전"} size={104} />
          </Link>
        )}
      </div>
      <h2 className="mt-l">온라인 광고</h2>
      <div className="grid g-3 mt">
        {AD_CHANNELS.map((c) => {
          const st = client.channels[c.id];
          const status = !st?.contracted ? ["미집행", ""] : st.apiConnected ? ["성과 연결됨", "good"] : ["연결 준비 중", "warn"];
          return (
            <Link key={c.id} href={`${base}/ads/${c.id}`} className={`card kpi ${st?.contracted ? "" : "empty"}`}>
              <div className="label">{c.label}</div><div className="row mt-s"><span className={`badge ${status[1]}`}>{status[0]}</span></div>
            </Link>
          );
        })}
      </div>
      <p className="faint mt-l">계약 항목: {Object.keys(s).map((k) => SERVICE_LABELS[k] ?? k).join(" · ") || "-"}</p>
    </>
  );
}

// 지난 레포트 보기: 자료가 있는 달 목록 (막대 = 그달 발행·게시 건수)
function HistorySection({ months, thisMonth, base, services }: { months: HistoryMonth[]; thisMonth: string; base: string; services: string[] }) {
  const past = months.filter((m) => m.period < thisMonth);
  if (past.length === 0) return <div className="empty-state"><b>지난 레포트가 아직 없습니다.</b>이번 달 리포트는 왼쪽 ‘대시보드’에서 볼 수 있습니다.</div>;
  const total = (m: HistoryMonth) => m.blog + m.cafe + (m.daangn ?? 0) + m.cardnews + m.column;
  const max = Math.max(1, ...past.map(total));
  const parts = [
    { k: "blog" as const, label: "블로그", on: services.includes("blog") },
    { k: "column" as const, label: "칼럼", on: services.includes("column") },
    { k: "cafe" as const, label: "카페", on: services.includes("cafe") },
    { k: "daangn" as const, label: "당근", on: services.includes("daangn") },
    { k: "cardnews" as const, label: "카드뉴스", on: services.includes("cardnews") },
  ];
  return (
    <>
      <p className="faint">달을 누르면 그달 리포트가 열립니다. 막대 길이는 그달 발행·게시 건수입니다.</p>
      <div className="hist-grid mt">
        {past.map((m) => (
          <Link key={m.period} href={`${base}?period=${m.period}`} className="card hist">
            <div className="hist-h"><b>{m.period.replace("-", "년 ")}월</b><span className="faint">리포트 보기 ›</span></div>
            <div className="hist-bar" title={parts.map((p) => `${p.label} ${m[p.k]}`).join(" · ")}>
              {parts.map((p, i) => m[p.k] > 0 && <i key={p.k} className={`hb-${i + 1}`} style={{ width: `${(m[p.k] / max) * 100}%` }} />)}
            </div>
            <div className="hist-f">
              {parts.filter((p) => p.on || m[p.k] > 0).map((p) => <span key={p.k}><i className={`lg hb-${parts.indexOf(p) + 1}`} />{p.label} {m[p.k]}</span>)}
              {m.adCost != null && <span>네이버 광고비 {Math.round(m.adCost).toLocaleString("ko-KR")}원</span>}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
