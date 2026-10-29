// 광고주 리포트 페이지 본문 (직원 경로·광고주 경로 공용, 서버 컴포넌트)
import Link from "next/link";
import { notFound } from "next/navigation";
import { basePath, getClientSummary, getNaverReport, kstToday, getNaverTopKeywords, resolveKeywordWindow, resolvePeriod, type ClientSummary, type ReportCtx } from "@/lib/report";
import { captureUrls, currentPeriod, getContentForRequest, getHistory, SERVICE_LABELS, type HistoryMonth, type ReportContent } from "@/lib/content";
import ReportShell, { AD_CHANNELS, isActiveChannel, isContracted, MENUS, visibleMenus, type AdChannelId } from "./ReportShell";
import NaverAdsView from "./NaverAdsView";
import { BlogSection, CafeSection, ColumnSection, PlaceAdsSection, PlaceSection, SnsSection } from "./ContentSections";
import ContractsSection from "./ContractsSection";
import SectionTools, { type SectionKind } from "./SectionTools";
import AdContractButton from "./AdContractButton";
import AdCreatives, { type Creative } from "./AdCreatives";
import { supabaseForClientLink, supabaseForStaff } from "@/lib/supabase/server";
import { getLinkStatus } from "@/lib/links";
import { getInHouseIds, getMonthOverview, monthInfo } from "@/lib/month";
import { Donut } from "./charts";
import SheetTabs, { type Sheet } from "./SheetTabs";
import ReviewSection from "./review/ReviewSection";
import QuotesSection from "./QuotesSection";
import { getReviewSummary, REVIEW_KINDS } from "@/lib/review";

// 받침 있으면 "은", 없으면 "는" (예: 당근마켓 바이럴은, 홈페이지 칼럼은, SNS 카드뉴스는)
const eunNeun = (w: string) => {
  const c = w.charCodeAt(w.length - 1);
  return `${w}${c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? "은" : "는"}`;
};

const SECTION_KIND: Partial<Record<string, SectionKind>> = { blog: "blog", column: "column", place: "place", cafe: "cafe", daangn: "daangn", sns: "cardnews" };

// 미집행 메뉴라도 등록된 내용이 있으면 보여준다
function hasContent(c: ReportContent, key: string) {
  if (key === "blog") return c.blog.length > 0;
  if (key === "column") return c.columns.length > 0;
  if (key === "cafe" || key === "daangn") return c.cafe.some((x) => (x.channel ?? "cafe") === key);
  if (key === "sns") return c.cardnews.length > 0;
  if (key === "place") return c.keywords.some((k) => k.kind === "place");
  return false;
}

// 직원 경로 전용: 이 메뉴의 이번 달 계약 수량(견적 + 추가) 요약과 입력 도구
async function StaffSectionTools({ clientId, period, kind, contracted, content, add, inHouse }: { clientId: string; period: string; kind: SectionKind; contracted: boolean; content: ReportContent; add?: string; inHouse: boolean }) {
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
  return <SectionTools clientId={clientId} period={period} kind={kind} contracted={contracted} lastDay={monthInfo(period).last} nextRound={nextRound} summary={summary} inHouse={inHouse} initialOpen={add === "extra" ? "extra" : add === "content" ? "content" : null} />;
}

export default async function ReportPage({
  ctx, section: rawSection, searchParams, staffTools,
}: { ctx: ReportCtx; section: string[]; searchParams: Record<string, string | undefined>; staffTools: boolean }) {
  // 광고주 화면 미리보기: 직원 경로 /admin/clients/{id}/preview/... → 광고주 링크와 똑같이 그린다 (직원용 도구 없음)
  const preview = ctx.mode === "staff" && rawSection[0] === "preview";
  const section = preview ? rawSection.slice(1) : rawSection;
  const staffView = ctx.mode === "staff" && staffTools && !preview;   // 직원용 도구를 그릴지
  // 광고주 정보와 리포트 내용은 서로 기다릴 필요가 없어 동시에 불러온다
  const [client, content] = await Promise.all([getClientSummary(ctx), getContentForRequest(ctx, searchParams.period)]);
  if (!client || !content) notFound();   // 틀린 링크·권한 없음: 존재 여부를 구분하지 않는다
  const base = basePath(ctx) + (preview ? "/preview" : "");
  // 직원 경로: 광고주 링크 발급 현황 (화면 위쪽 표시)
  const link = ctx.mode === "staff" ? ((await getLinkStatus([ctx.clientId])).get(ctx.clientId) ?? { active: 0, issuedAt: null, lastUsedAt: null }) : null;
  const key = section.join("/");
  const services = Object.keys(content.services);
  // 파일 검수: 대기 건수(사이드바) · 유형별 검수 현황(대시보드) — 개수만, 리포트 내용과 섞지 않는다
  const review = await getReviewSummary(ctx, currentPeriod());
  const monthLabel = `${content.period.replace("-", "년 ")}월`;

  let title: string;
  const inHouse = ctx.mode === "staff" ? (await getInHouseIds()).has(ctx.clientId) : false;   // 자사 마케팅: 계약 표현 없이 업무 항목
  let body: React.ReactNode;
  if (section[0] === "ads") {
    const ch = AD_CHANNELS.find((c) => c.id === section[1]);
    const placeAd = ch?.id === "naver" && section[2] === "place";
    if (!ch || (section.length !== 2 && !placeAd)) notFound();
    title = placeAd ? "네이버 플레이스 광고" : ch.id === "naver" ? "네이버 파워링크 광고" : ch.label;
    // 집행 중인 광고 소재를 성과보다 먼저 (계약한 채널만)
    const creatives = client.channels[ch.id]?.contracted ? await getCreatives(ctx, ch.id) : null;
    body = (
      <>
        {creatives && <AdCreatives items={creatives} editable={staffView} clientId={ctx.mode === "staff" ? ctx.clientId : undefined} channel={ch.id} label={ch.label} />}
        {placeAd
          ? (client.channels.naver?.contracted ? <PlaceAdsSection c={content} area={client.area} />
            : staffView ? await adsBody(ctx, client, ch.id, "네이버 플레이스 광고", `${base}/ads/naver/place`, searchParams, staffView, inHouse) : <p className="off-note"><span className="badge">미집행</span> {inHouse ? "집행하지 않는 광고입니다." : "이번 계약에 포함되지 않은 광고입니다."}</p>)
          : await adsBody(ctx, client, ch.id, ch.id === "naver" ? "네이버 파워링크 광고" : ch.label, `${base}/ads/${ch.id}`, searchParams, staffView, inHouse)}
      </>
    );
  } else if (section[0] === "review" && section.length <= 2) {
    title = section[1] ? "파일 검수 · 상세" : "파일 검수";
    body = <ReviewSection clientId={client.id} clientName={client.name} base={base} itemId={section[1] ?? null} period={searchParams.period} kind={searchParams.kind} staffView={staffView} thisMonth={currentPeriod()} linkToken={ctx.mode === "client" ? ctx.token : null} />;
  } else if (key === "full") {
    title = "레포트 상세보기";
    body = <FullReport ctx={ctx} client={client} content={content} base={base} services={services} staffView={staffView} searchParams={searchParams} />;
  } else if (key === "history") {
    title = "지난 레포트 보기";
    body = <HistorySection months={await getHistory(ctx)} thisMonth={currentPeriod()} base={base} services={services} />;
  } else if (key === "quotes") {
    // 광고주 화면(링크 · 미리보기) 메뉴. 직원은 '계약 · 견적 관리'에서 관리한다
    title = "견적서";
    body = <QuotesSection ctx={ctx} />;
  } else if (key === "contracts") {
    // 직원 경로에서만 열린다 (광고주 링크로는 이 주소가 없다)
    if (ctx.mode !== "staff" || !staffView) notFound();
    title = inHouse ? "업무 항목 관리" : "계약 · 견적 관리";
    body = <ContractsSection clientId={ctx.clientId} requested={searchParams.period} inHouse={inHouse} />;
  } else {
    const menu = MENUS.find((m) => m.id === key);
    if (!menu || !visibleMenus(services).includes(menu)) notFound();   // 고정 메뉴가 아니고 계약하지 않은 항목(플레이스)의 주소는 열리지 않는다
    title = menu.label;
    let inner: React.ReactNode;
    if (key === "") inner = <Dashboard ctx={ctx} client={client} content={content} base={base} staff={staffView} inHouse={inHouse} />;
    else if (key === "blog") inner = <BlogSection c={content} tab={searchParams.tab ?? "posts"} path={`${base}/blog`} editable={staffView}
      urls={searchParams.tab === "etc" ? await captureUrls(ctx, content.keywords.map((k) => k.exposure?.capture ?? null)) : undefined} />;
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
        {!contracted && (staffView ? (
          <div className="empty-state off-state off-banner">
            {inHouse ? <><b>{eunNeun(menu.label)} 이번 달 진행하지 않는 항목입니다.</b>
            진행하려면 아래 ‘+ 항목 추가’로 수량과 마감일을 등록하세요.</>
            : <><b>{eunNeun(menu.label)} 이번 계약에 포함되지 않은 미집행 항목입니다.</b>
            중간에 계약되면 아래 ‘+ 추가 계약’으로 수량과 마감일을 등록하세요.</>}
          </div>
        ) : <p className="off-note"><span className="badge">미집행</span> {inHouse ? "이번 달 진행하지 않는 항목입니다." : "이번 계약에 포함되지 않은 항목입니다."}</p>)}
        {kind && ctx.mode === "staff" && staffView && <StaffSectionTools clientId={ctx.clientId} period={content.period} kind={kind} contracted={contracted} content={content} add={searchParams.add} inHouse={inHouse} />}
        {(contracted || hasContent(content, key)) && inner}
      </>
    );
  }

  return (
    <ReportShell client={client} base={base} section={section} title={title}
      eyebrow={`${client.name} · ${section[0] === "ads" ? "온라인 광고" : key === "history" || key === "contracts" || key === "quotes" ? "월별 관리" : `${monthLabel} 마케팅 리포트`}`}
      staffTools={staffView} preview={preview ? basePath(ctx) : null} link={link} reviewPending={review?.pending ?? 0} inHouse={inHouse} services={services} period={content.period} thisMonth={currentPeriod()}>
      {body}
    </ReportShell>
  );
}

// 광고 소재 목록 + 이미지 주소 (직원: 로그인 세션 서명 주소, 광고주 링크: 토큰 확인 함수)
async function getCreatives(ctx: ReportCtx, channel: string): Promise<Creative[]> {
  const rows = ctx.mode === "staff"
    ? ((await (await supabaseForStaff()).from("ad_creatives").select("id, title, storage_path").eq("client_id", ctx.clientId).eq("channel", channel).eq("active", true).order("sort").order("created_at", { ascending: false })).data ?? [])
        .map((r) => ({ id: r.id, title: r.title, path: r.storage_path }))
    : (((await supabaseForClientLink().rpc("report_ad_creatives", { p_token: ctx.token, p_channel: channel })).data ?? []) as { id: string; title: string | null; path: string }[]);
  const urls = await captureUrls(ctx, rows.map((r) => r.path));
  return rows.map((r) => ({ ...r, url: urls.get(r.path) ?? null }));
}

async function adsBody(ctx: ReportCtx, client: ClientSummary, ch: AdChannelId, label: string, path: string, sp: Record<string, string | undefined>, staffView: boolean, inHouse = false) {
  const state = client.channels[ch];
  if (!state?.contracted && !staffView) return <p className="off-note"><span className="badge">미집행</span> {inHouse ? "집행하지 않는 광고입니다." : "이번 계약에 포함되지 않은 광고입니다."}</p>;
  if (!state?.contracted) {
    const others = AD_CHANNELS.filter((c) => c.id !== ch && isActiveChannel(client, c.id));
    return (
      <div className="empty-state off-state">
        <b>{eunNeun(label)} 집행되지 않는 광고입니다.</b>
        {inHouse ? "집행 중인 광고가 아니어서" : "계약된 광고가 아니어서"} 표시할 성과가 없습니다.
        {ctx.mode === "staff" && staffView && <div className="row mt" style={{ justifyContent: "center" }}><AdContractButton clientId={ctx.clientId} channel={ch} label={label} inHouse={inHouse} /></div>}
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
        {inHouse ? "집행 채널이며" : "계약된 채널이며"}, 광고 계정 연결이 끝나면 매일 오전 9시에 성과가 자동으로 반영됩니다.
      </div>
    );
  }
  const period = resolvePeriod(sp);
  const kwWindow = resolveKeywordWindow(sp.kwm, period.to);
  const [data, topKeywords] = await Promise.all([getNaverReport(ctx, period.from, period.to), getNaverTopKeywords(ctx, kwWindow)]);
  if (!data) return <div className="notice">성과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>;
  if (data.notContracted) return <div className="empty-state off-state"><b>{eunNeun(label)} 집행되지 않는 광고입니다.</b></div>;
  // 담당자 코멘트: 직원 화면에서만 편집, 광고주 링크 화면은 읽기 전용
  const note = ctx.mode === "staff" && staffView ? { editable: true as const, clientId: ctx.clientId, period: period.to.slice(0, 7) } : { editable: false as const };
  const kwSort = sp.kwsort === "impressions" || sp.kwsort === "cost" ? sp.kwsort : "clicks";
  return <NaverAdsView data={data} period={period} path={path} note={note} top={{ window: kwWindow, keywords: topKeywords, sort: kwSort }} query={sp} />;
}

// 대시보드: 모든 업무 항목과 광고 채널을 기본 카드로 표시. 계약하지 않은 항목은 "미집행",
// 직원 화면에서는 그 아래 [+ 추가하기] (→ 해당 메뉴의 추가 계약 입력이 열린 상태로 이동)
async function Dashboard({ ctx, client, content, base, staff, summaryOnly = false, inHouse = false }: { ctx: ReportCtx; client: ClientSummary; content: ReportContent; base: string; staff: boolean; summaryOnly?: boolean; inHouse?: boolean }) {
  const s = content.services;
  const past = content.period !== currentPeriod();
  const q = past ? `?period=${content.period}` : "";
  const top5 = content.blog.filter((b) => (b.rank?.main ?? 99) <= 5 || (b.rank?.blogTab ?? 99) <= 5).length;
  const place = content.keywords.filter((k) => k.kind === "place");
  const placeShown = place.filter((p) => p.place?.rank != null).length;
  const placeAt = place.map((p) => p.place?.at).filter(Boolean).sort().at(-1);
  const cafe = content.cafe.filter((x) => (x.channel ?? "cafe") === "cafe");
  const daangn = content.cafe.filter((x) => x.channel === "daangn");
  const views = (l: typeof cafe) => l.reduce((a, x) => a + (x.views ?? 0), 0).toLocaleString("ko-KR");
  const cards: { id: string; label: string; on: boolean; done: number; target: number | null; unit: string; foot: string }[] = [
    { id: "blog", label: "블로그 발행", on: !!s.blog, done: content.blog.length, target: s.blog?.target ?? null, unit: "건", foot: `5위 이내 ${top5}건` },
    { id: "column", label: "홈페이지 칼럼", on: !!s.column, done: content.columns.length, target: s.column?.target ?? null, unit: "건", foot: "SEO · AEO용 칼럼" },
    // 플레이스: 계약 수량 없이 고정 키워드를 매일 확인 → 정상 노출 키워드 수
    { id: "place", label: "플레이스 정상 노출", on: !!s.place, done: placeShown, target: place.length || null, unit: "개",
      foot: placeAt ? `고정 키워드 매일 확인 · ${placeAt.slice(5, 10).replace("-", "/")}` : "확인 전" },
    { id: "cafe", label: "카페 바이럴", on: !!s.cafe, done: cafe.filter((x) => x.status !== "삭제됨").length, target: s.cafe?.target ?? null, unit: "건", foot: `조회 ${views(cafe)}` },
    { id: "daangn", label: "당근마켓 바이럴", on: !!s.daangn, done: daangn.filter((x) => x.status !== "삭제됨").length, target: s.daangn?.target ?? null, unit: "건", foot: `조회 ${views(daangn)}` },
    { id: "sns", label: "SNS 카드뉴스", on: !!s.cardnews, done: content.cardnews.length, target: s.cardnews?.target ?? null, unit: "회차", foot: `인스타·카카오·당근 소식 ${content.cardnews.reduce((a, r) => a + r.links.length, 0)}개` },
  ];
  // 직원 화면: 크게 "미집행" + [+ 추가하기] / 광고주 링크: 작은 "미집행" 표시만
  const off = (label: string, foot: string, action: React.ReactNode) => staff
    ? <><div className="label">{label}</div><div className="value">미집행</div><div className="foot">{foot}</div>{action && <div className="off-act">{action}</div>}</>
    : <><div className="label">{label}</div><span className="badge">미집행</span></>;
  const offCls = `card kpi donut-card off-card ${staff ? "" : "mini"}`;
  return (
    <>
      {!summaryOnly && <Link href={`${base}/full${q}`} className="full-cta">
        <span><b>레포트 상세보기</b><span className="faint">블로그 · 플레이스 · 카페 · SNS · 광고까지 이번 달 내용을 한 페이지에서 탭으로 보고 PDF로 저장</span></span>
        <span className="btn primary">상세보기 열기 ›</span>
      </Link>}
      <MonthSummary ctx={ctx} client={client} content={content} cards={cards} inHouse={inHouse} />
      {!summaryOnly && <ReviewStatus ctx={ctx} period={content.period} base={base} />}
      <h2 className="mt-l">마케팅 업무</h2>
      <div className="grid g-donut mt">
        {(staff ? cards : [...cards].sort((a, b) => Number(!(a.on || a.done)) - Number(!(b.on || b.done)))).map((c) => !c.on && !c.done ? (
          <div key={c.id} className={offCls}>
            {off(c.label, inHouse ? "이번 달 진행하지 않음" : "계약에 포함되지 않음", staff && <Link className="btn sm primary" href={`${base}/${c.id}?add=extra`}>+ 추가하기</Link>)}
          </div>
        ) : (
          <Link key={c.id} href={`${base}/${c.id}${q}`} className="card kpi donut-card">
            {c.target ? <Donut done={c.done} total={c.target} label={c.label} sub={c.foot} size={104} />
              : <><div className="label">{c.label}</div><div className="value num">{c.done}<small>{c.unit}</small></div><div className="foot">{c.foot}</div></>}
          </Link>
        ))}
      </div>
      <h2 className="mt-l">온라인 광고</h2>
      <div className="grid g-donut mt">
        {(staff ? [...AD_CHANNELS] : [...AD_CHANNELS].sort((a, b) => Number(!!client.channels[b.id]?.contracted) - Number(!!client.channels[a.id]?.contracted))).map((c) => {
          const st = client.channels[c.id];
          if (!st?.contracted) return (
            <div key={c.id} className={offCls}>
              {off(c.label, "집행하지 않는 광고", staff && <AdContractButton clientId={client.id} channel={c.id} label={c.label} compact inHouse={inHouse} />)}
            </div>
          );
          const status = st.apiConnected ? ["성과 연결됨", "good"] : ["연결 준비 중", "warn"];
          return (
            <Link key={c.id} href={`${base}/ads/${c.id}`} className="card kpi donut-card">
              <div className="label">{c.label}</div><div className="value sm-v">집행 중</div><div className="row mt-s"><span className={`badge ${status[1]}`}>{status[0]}</span></div>
            </Link>
          );
        })}
      </div>
      <p className="faint mt-l">{inHouse ? "진행 항목" : "계약 항목"}: {Object.keys(s).map((k) => SERVICE_LABELS[k] ?? k).join(" · ") || "-"}</p>
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

// 이번 달 요약: 핵심 수치 3개 (발행·게시 합계 · 계약 수량 진행률 · 네이버 광고 또는 플레이스)
async function MonthSummary({ ctx, client, content, cards, inHouse = false }: {
  ctx: ReportCtx; client: ClientSummary; content: ReportContent; inHouse?: boolean;
  cards: { id: string; label: string; on: boolean; done: number; target: number | null }[];
}) {
  const work = cards.filter((c) => c.id !== "place");
  const posted = work.reduce((a, c) => a + c.done, 0);
  const withTarget = work.filter((c) => c.on && c.target);
  const target = withTarget.reduce((a, c) => a + (c.target ?? 0), 0);
  const done = withTarget.reduce((a, c) => a + Math.min(c.done, c.target ?? 0), 0);
  const rate = target ? Math.round((done / target) * 100) : null;
  const from = `${content.period}-01`;
  const yesterday = kstToday(-1);
  const to = content.period === yesterday.slice(0, 7) ? yesterday : new Date(Date.UTC(Number(content.period.slice(0, 4)), Number(content.period.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const naver = isActiveChannel(client, "naver") && to >= from ? await getNaverReport(ctx, from, to) : null;
  const place = content.keywords.filter((k) => k.kind === "place");
  const shown = place.filter((k) => k.place?.rank != null).length;
  const third = naver && !naver.notContracted
    ? { label: "네이버 광고", value: `${naver.kpi.clicks.toLocaleString("ko-KR")}회 클릭`, foot: `노출 ${naver.kpi.impressions.toLocaleString("ko-KR")} · 광고비 ${Math.round(naver.kpi.cost).toLocaleString("ko-KR")}원` }
    : place.length ? { label: "플레이스 정상 노출", value: `${shown} / ${place.length}개`, foot: "고정 키워드 매일 확인" } : null;
  const [y, m] = content.period.split("-").map(Number);
  return (
    <section className="card pad month-summary">
      <div className="card-h"><h2>이번 달 요약</h2><span className="faint">{y}년 {m}월 · {Number(to.slice(5, 7))}/{Number(to.slice(8, 10))}까지 집계</span></div>
      <div className="ms-grid">
        <div className="ms-stat"><span className="faint">발행 · 게시 콘텐츠</span><b className="num">{posted}<small>건</small></b><span className="faint">{work.filter((c) => c.done > 0).map((c) => `${c.label.replace(" 발행", "")} ${c.done}`).join(" · ") || "이번 달 등록 전"}</span></div>
        <div className="ms-stat"><span className="faint">{inHouse ? "업무 수량 진행률" : "계약 수량 진행률"}</span><b className="num">{rate == null ? "-" : rate}<small>{rate == null ? "" : "%"}</small></b><span className="faint">{target ? `${done} / ${target}건 완료` : inHouse ? "등록된 수량 없음" : "계약 수량 없음"}</span></div>
        {third && <div className="ms-stat"><span className="faint">{third.label}</span><b className="num">{third.value}</b><span className="faint">{third.foot}</span></div>}
      </div>
    </section>
  );
}

// 레포트 상세보기: 이번 달 모든 항목을 한 페이지에 엑셀 시트처럼 탭으로 (계약한 항목 · 자료가 있는 항목만)
async function FullReport({ ctx, client, content, base, services, staffView, searchParams }: {
  ctx: ReportCtx; client: ClientSummary; content: ReportContent; base: string; services: string[]; staffView: boolean; searchParams: Record<string, string | undefined>;
}) {
  const on = (svc: string, has: boolean) => services.includes(svc) || has;
  const cafe = content.cafe.filter((x) => (x.channel ?? "cafe") === "cafe");
  const daangn = content.cafe.filter((x) => x.channel === "daangn");
  const place = content.keywords.filter((k) => k.kind === "place");
  const exposure = new Set(content.keywords.filter((k) => k.kind === "etc" || k.kind === "aeo").map((k) => k.keyword));
  const [pUrls, cUrls, dUrls, eUrls] = await Promise.all([
    captureUrls(ctx, place.map((k) => k.place?.capture ?? null)),
    captureUrls(ctx, cafe.map((x) => x.capture)),
    captureUrls(ctx, daangn.map((x) => x.capture)),
    exposure.size ? captureUrls(ctx, content.keywords.map((k) => k.exposure?.capture ?? null)) : Promise.resolve(new Map<string, string>()),
  ]);
  // 광고: 그달 1일 ~ 어제(지난 달이면 말일)
  const from = `${content.period}-01`;
  const y = kstToday(-1);
  const to = content.period === y.slice(0, 7) ? y : new Date(Date.UTC(Number(content.period.slice(0, 4)), Number(content.period.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const adSp = { ...searchParams, range: "custom", from, to };
  // 탭 = 좌측 메뉴와 같은 내용 (전체 요약은 좌측 '대시보드'에서). 계약했거나 자료가 있는 항목만
  const sheets: Sheet[] = [];
  if (on("blog", content.blog.length > 0)) sheets.push({ id: "blog", label: "블로그", badge: String(content.blog.length), node: <BlogSection c={content} tab="posts" path={`${base}/blog`} bare /> });
  if (on("column", content.columns.length > 0)) sheets.push({ id: "column", label: "홈페이지 칼럼", badge: String(content.columns.length), node: <ColumnSection c={content} /> });
  const cafeOn = on("cafe", cafe.length > 0), daangnOn = on("daangn", daangn.length > 0);
  if (cafeOn || daangnOn) sheets.push({ id: "viral", label: cafeOn && daangnOn ? "카페 · 당근" : cafeOn ? "카페 바이럴" : "당근마켓 바이럴", badge: String(cafe.length + daangn.length), node: (
    <>
      {cafeOn && <><h3 className="sheet-sub">카페 바이럴</h3><CafeSection c={content} list={cafe} channel="cafe" urls={cUrls} /></>}
      {daangnOn && <><h3 className="sheet-sub">당근마켓 바이럴</h3><CafeSection c={content} list={daangn} channel="daangn" urls={dUrls} /></>}
    </>
  ) });
  if (on("place", place.length > 0)) sheets.push({ id: "place", label: "플레이스 순위", badge: String(place.length), node: <PlaceSection c={content} urls={pUrls} /> });
  if (on("cardnews", content.cardnews.length > 0)) sheets.push({ id: "sns", label: "SNS 카드뉴스", badge: String(content.cardnews.length), node: <SnsSection c={content} /> });
  // 온라인 광고: 계약한 채널을 한 탭에 (각 채널 메뉴와 같은 내용 — 집행 중인 광고 소재 → 성과)
  const ads: React.ReactNode[] = [];
  for (const ch of AD_CHANNELS) {
    if (!client.channels[ch.id]?.contracted) continue;
    const creatives = await getCreatives(ctx, ch.id);
    const head = ch.id === "naver" ? "네이버 파워링크 광고" : ch.label;
    ads.push(
      <section key={ch.id} className="sheet-block">
        <h3 className="sheet-sub">{head}</h3>
        <AdCreatives items={creatives} editable={false} channel={ch.id} label={head} />
        {await adsBody(ctx, client, ch.id, head, `${base}/ads/${ch.id}`, adSp, false)}
      </section>,
    );
    if (ch.id === "naver") ads.push(<section key="naver-place" className="sheet-block"><h3 className="sheet-sub">네이버 플레이스 광고</h3><PlaceAdsSection c={content} area={client.area} /></section>);
  }
  if (ads.length) sheets.push({ id: "ads", label: "온라인 광고", node: <>{ads}</> });
  // 기타 노출 (기타 · AEO 키워드): 맨 마지막 탭
  if (exposure.size) sheets.push({ id: "exposure", label: "기타 노출", badge: String(exposure.size), node: <BlogSection c={content} tab="etc" path={`${base}/blog`} bare urls={eUrls} /> });
  void staffView;
  const [yy, mm] = content.period.split("-").map(Number);
  return <SheetTabs sheets={sheets} title={`${client.name} ${yy}년 ${mm}월 레포트`} xlsx={`${basePath(ctx)}/export?period=${content.period}`} />;
}

// 대시보드 '이번 달 요약' 아래: 콘텐츠 검수 현황 (유형별 건수만, 리포트 · PDF 에는 넣지 않음)
// 유형별 전체 = 검수 요청 건수와 그달 계약 수량 중 큰 값 → 일부만 등록 · 승인된 상태를 '검수 완료'로 표시하지 않는다
async function ReviewStatus({ ctx, period, base }: { ctx: ReportCtx; period: string; base: string }) {
  const s = await getReviewSummary(ctx, period);
  const kinds = s?.kinds ?? [];
  if (kinds.length === 0) return null;
  return (
    <section className="card pad review-status no-print">
      <div className="card-h"><h2>콘텐츠 검수 현황</h2><Link href={`${base}/review`} className="btn sm">파일 검수 ›</Link></div>
      <ul className="review-status-list">
        {kinds.map((k) => {
          const done = k.target > 0 && k.approved >= k.target;
          return (
            <li key={k.kind}>
              <b>{REVIEW_KINDS[k.kind] ?? k.kind}</b>
              {done ? <span className="badge good">{k.target}건 검수 완료</span> : <span className="badge warn">검수 진행 중 ({k.approved}/{k.target}건)</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
