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
import { getMonthOverview, monthInfo } from "@/lib/month";
import { Donut } from "./charts";

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
async function StaffSectionTools({ clientId, period, kind, contracted, content, add }: { clientId: string; period: string; kind: SectionKind; contracted: boolean; content: ReportContent; add?: string }) {
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
  return <SectionTools clientId={clientId} period={period} kind={kind} contracted={contracted} lastDay={monthInfo(period).last} nextRound={nextRound} summary={summary} initialOpen={add === "extra" ? "extra" : add === "content" ? "content" : null} />;
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
  const monthLabel = `${content.period.replace("-", "년 ")}월`;

  let title: string;
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
            : staffView ? await adsBody(ctx, client, ch.id, "네이버 플레이스 광고", `${base}/ads/naver/place`, searchParams, staffView) : <p className="off-note"><span className="badge">미집행</span> 이번 계약에 포함되지 않은 광고입니다.</p>)
          : await adsBody(ctx, client, ch.id, ch.id === "naver" ? "네이버 파워링크 광고" : ch.label, `${base}/ads/${ch.id}`, searchParams, staffView)}
      </>
    );
  } else if (key === "history") {
    title = "지난 레포트 보기";
    body = <HistorySection months={await getHistory(ctx)} thisMonth={currentPeriod()} base={base} services={services} />;
  } else if (key === "contracts") {
    // 직원 경로에서만 열린다 (광고주 링크로는 이 주소가 없다)
    if (ctx.mode !== "staff" || !staffView) notFound();
    title = "계약 · 견적 관리";
    body = <ContractsSection clientId={ctx.clientId} requested={searchParams.period} />;
  } else {
    const menu = MENUS.find((m) => m.id === key);
    if (!menu || !visibleMenus(services).includes(menu)) notFound();   // 고정 메뉴가 아니고 계약하지 않은 항목(플레이스)의 주소는 열리지 않는다
    title = menu.label;
    let inner: React.ReactNode;
    if (key === "") inner = <Dashboard ctx={ctx} client={client} content={content} base={base} staff={staffView} />;
    else if (key === "blog") inner = <BlogSection c={content} tab={searchParams.tab ?? "posts"} path={`${base}/blog`} editable={staffView} />;
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
            <b>{eunNeun(menu.label)} 이번 계약에 포함되지 않은 미집행 항목입니다.</b>
            중간에 계약되면 아래 ‘+ 추가 계약’으로 수량과 마감일을 등록하세요.
          </div>
        ) : <p className="off-note"><span className="badge">미집행</span> 이번 계약에 포함되지 않은 항목입니다.</p>)}
        {kind && ctx.mode === "staff" && staffView && <StaffSectionTools clientId={ctx.clientId} period={content.period} kind={kind} contracted={contracted} content={content} add={searchParams.add} />}
        {(contracted || hasContent(content, key)) && inner}
      </>
    );
  }

  return (
    <ReportShell client={client} base={base} section={section} title={title}
      eyebrow={`${client.name} · ${section[0] === "ads" ? "온라인 광고" : key === "history" || key === "contracts" ? "월별 관리" : `${monthLabel} 마케팅 리포트`}`}
      staffTools={staffView} preview={preview ? basePath(ctx) : null} link={link} services={services} period={content.period} thisMonth={currentPeriod()}>
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

async function adsBody(ctx: ReportCtx, client: ClientSummary, ch: AdChannelId, label: string, path: string, sp: Record<string, string | undefined>, staffView: boolean) {
  const state = client.channels[ch];
  if (!state?.contracted && !staffView) return <p className="off-note"><span className="badge">미집행</span> 이번 계약에 포함되지 않은 광고입니다.</p>;
  if (!state?.contracted) {
    const others = AD_CHANNELS.filter((c) => c.id !== ch && isActiveChannel(client, c.id));
    return (
      <div className="empty-state off-state">
        <b>{eunNeun(label)} 집행되지 않는 광고입니다.</b>
        계약된 광고가 아니어서 표시할 성과가 없습니다.
        {ctx.mode === "staff" && staffView && <div className="row mt" style={{ justifyContent: "center" }}><AdContractButton clientId={ctx.clientId} channel={ch} label={label} /></div>}
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
  const note = ctx.mode === "staff" && staffView ? { editable: true as const, clientId: ctx.clientId, period: period.to.slice(0, 7) } : { editable: false as const };
  const kwSort = sp.kwsort === "impressions" || sp.kwsort === "cost" ? sp.kwsort : "clicks";
  return <NaverAdsView data={data} period={period} path={path} note={note} top={{ window: kwWindow, keywords: topKeywords, sort: kwSort }} query={sp} />;
}

// 대시보드: 모든 업무 항목과 광고 채널을 기본 카드로 표시. 계약하지 않은 항목은 "미집행",
// 직원 화면에서는 그 아래 [+ 추가하기] (→ 해당 메뉴의 추가 계약 입력이 열린 상태로 이동)
async function Dashboard({ ctx, client, content, base, staff }: { ctx: ReportCtx; client: ClientSummary; content: ReportContent; base: string; staff: boolean }) {
  const s = content.services;
  const past = content.period !== currentPeriod();
  const q = past ? `?period=${content.period}` : "";
  const top5 = content.blog.filter((b) => (b.rank?.main ?? 99) <= 5 || (b.rank?.blogTab ?? 99) <= 5).length;
  const place = content.keywords.filter((k) => k.kind === "place");
  const placeRanks = place.map((p) => p.place?.rank).filter((v): v is number => v != null);
  const cafe = content.cafe.filter((x) => (x.channel ?? "cafe") === "cafe");
  const daangn = content.cafe.filter((x) => x.channel === "daangn");
  const views = (l: typeof cafe) => l.reduce((a, x) => a + (x.views ?? 0), 0).toLocaleString("ko-KR");
  const cards: { id: string; label: string; on: boolean; done: number; target: number | null; unit: string; foot: string }[] = [
    { id: "blog", label: "블로그 발행", on: !!s.blog, done: content.blog.length, target: s.blog?.target ?? null, unit: "건", foot: `5위 이내 ${top5}건` },
    { id: "column", label: "홈페이지 칼럼", on: !!s.column, done: content.columns.length, target: s.column?.target ?? null, unit: "건", foot: "SEO · AEO용 칼럼" },
    { id: "place", label: "플레이스 Top 3", on: !!s.place, done: placeRanks.filter((v) => v <= 3).length, target: place.length || null, unit: "개",
      foot: placeRanks.length ? `평균 ${(placeRanks.reduce((a, b) => a + b, 0) / placeRanks.length).toFixed(1)}위` : "수집 전" },
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
      <MonthSummary ctx={ctx} client={client} content={content} cards={cards} />
      <h2 className="mt-l">마케팅 업무</h2>
      <div className="grid g-donut mt">
        {(staff ? cards : [...cards].sort((a, b) => Number(!(b.on || b.done)) - Number(!(a.on || a.done)))).map((c) => !c.on && !c.done ? (
          <div key={c.id} className={offCls}>
            {off(c.label, "계약에 포함되지 않음", staff && <Link className="btn sm primary" href={`${base}/${c.id}?add=extra`}>+ 추가하기</Link>)}
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
              {off(c.label, "집행하지 않는 광고", staff && <AdContractButton clientId={client.id} channel={c.id} label={c.label} compact />)}
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

// 이번 달 요약: 핵심 수치 3개 (발행·게시 합계 · 계약 수량 진행률 · 네이버 광고 또는 플레이스)
async function MonthSummary({ ctx, client, content, cards }: {
  ctx: ReportCtx; client: ClientSummary; content: ReportContent;
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
  const top3 = place.filter((k) => (k.place?.rank ?? 99) <= 3).length;
  const third = naver && !naver.notContracted
    ? { label: "네이버 광고", value: `${naver.kpi.clicks.toLocaleString("ko-KR")}회 클릭`, foot: `노출 ${naver.kpi.impressions.toLocaleString("ko-KR")} · 광고비 ${Math.round(naver.kpi.cost).toLocaleString("ko-KR")}원` }
    : place.length ? { label: "플레이스 Top 3", value: `${top3} / ${place.length}개`, foot: "지정 키워드 중 3위 이내" } : null;
  const [y, m] = content.period.split("-").map(Number);
  return (
    <section className="card pad month-summary">
      <div className="card-h"><h2>이번 달 요약</h2><span className="faint">{y}년 {m}월 · {Number(to.slice(5, 7))}/{Number(to.slice(8, 10))}까지 집계</span></div>
      <div className="ms-grid">
        <div className="ms-stat"><span className="faint">발행 · 게시 콘텐츠</span><b className="num">{posted}<small>건</small></b><span className="faint">{work.filter((c) => c.done > 0).map((c) => `${c.label.replace(" 발행", "")} ${c.done}`).join(" · ") || "이번 달 등록 전"}</span></div>
        <div className="ms-stat"><span className="faint">계약 수량 진행률</span><b className="num">{rate == null ? "-" : rate}<small>{rate == null ? "" : "%"}</small></b><span className="faint">{target ? `${done} / ${target}건 완료` : "계약 수량 없음"}</span></div>
        {third && <div className="ms-stat"><span className="faint">{third.label}</span><b className="num">{third.value}</b><span className="faint">{third.foot}</span></div>}
      </div>
    </section>
  );
}
