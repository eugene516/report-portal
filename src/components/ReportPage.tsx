// 광고주 리포트 페이지 본문 (직원 경로·광고주 경로 공용, 서버 컴포넌트)
import Link from "next/link";
import { notFound } from "next/navigation";
import { basePath, getClientSummary, getNaverReport, resolvePeriod, type ClientSummary, type ReportCtx } from "@/lib/report";
import { captureUrls, getContentForRequest, SERVICE_LABELS, type ReportContent } from "@/lib/content";
import ReportShell, { AD_CHANNELS, isActiveChannel, MENUS, visibleMenus, type AdChannelId } from "./ReportShell";
import NaverAdsView from "./NaverAdsView";
import { BlogSection, CafeSection, PlaceSection, SnsSection } from "./ContentSections";

export default async function ReportPage({
  ctx, section, searchParams, staffTools,
}: { ctx: ReportCtx; section: string[]; searchParams: Record<string, string | undefined>; staffTools: boolean }) {
  const client = await getClientSummary(ctx);
  if (!client) notFound();   // 틀린 링크·권한 없음: 존재 여부를 구분하지 않는다
  const base = basePath(ctx);
  const key = section.join("/");
  const content = await getContentForRequest(ctx, searchParams.period);
  if (!content) notFound();
  const services = Object.keys(content.services);
  const monthLabel = `${content.period.replace("-", "년 ")}월`;

  let title: string;
  let body: React.ReactNode;
  if (section[0] === "ads") {
    const ch = AD_CHANNELS.find((c) => c.id === section[1]);
    if (!ch || section.length !== 2) notFound();
    title = ch.label;
    body = await adsBody(ctx, client, ch.id, ch.label, `${base}/ads/${ch.id}`, searchParams);
  } else {
    const menu = MENUS.find((m) => m.id === key);
    if (!menu || !visibleMenus(services).includes(menu)) notFound();   // 계약하지 않은 항목의 주소는 열리지 않는다
    title = menu.label;
    if (key === "") body = <Dashboard client={client} content={content} base={base} />;
    else if (key === "blog") body = <BlogSection c={content} tab={searchParams.tab ?? "posts"} path={`${base}/blog`} />;
    else if (key === "place") body = <PlaceSection c={content} urls={await captureUrls(ctx, content.keywords.map((k) => k.place?.capture ?? null))} />;
    else if (key === "cafe") body = <CafeSection c={content} urls={await captureUrls(ctx, content.cafe.map((x) => x.capture))} />;
    else body = <SnsSection c={content} />;
  }

  return (
    <ReportShell client={client} base={base} section={section} title={title}
      eyebrow={`${client.name} · ${section[0] === "ads" ? "온라인 광고" : `${monthLabel} 마케팅 리포트`}`}
      staffTools={staffTools} services={services} period={content.period} periods={content.periods}>
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
        <b>{label}는 집행되지 않는 광고입니다.</b>
        계약된 광고가 아니어서 표시할 성과가 없습니다.
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
  const data = await getNaverReport(ctx, period.from, period.to);
  if (!data) return <div className="notice">성과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>;
  if (data.notContracted) return <div className="empty-state off-state"><b>{label}는 집행되지 않는 광고입니다.</b></div>;
  // 담당자 코멘트: 직원 화면에서만 편집, 광고주 링크 화면은 읽기 전용
  const note = ctx.mode === "staff" ? { editable: true as const, clientId: ctx.clientId, period: period.to.slice(0, 7) } : { editable: false as const };
  return <NaverAdsView data={data} period={period} path={path} note={note} />;
}

function Dashboard({ client, content, base }: { client: ClientSummary; content: ReportContent; base: string }) {
  const s = content.services;
  const q = `?period=${content.period}`;
  const top5 = content.blog.filter((b) => (b.rank?.main ?? 99) <= 5 || (b.rank?.blogTab ?? 99) <= 5).length;
  const place = content.keywords.filter((k) => k.kind === "place");
  const placeRanks = place.map((p) => p.place?.rank).filter((v): v is number => v != null);
  const cards: { label: string; value: string; unit: string; foot: string; href: string }[] = [];
  if (s.blog) cards.push({ label: "블로그 발행", value: String(content.blog.length), unit: s.blog.target ? `/ ${s.blog.target}건` : "건", foot: `5위 이내 ${top5}건 (메인·블로그 탭)`, href: `${base}/blog${q}` });
  if (s.place) cards.push({ label: "플레이스 Top 3", value: String(placeRanks.filter((v) => v <= 3).length), unit: `/ ${place.length}개`, foot: placeRanks.length ? `평균 ${(placeRanks.reduce((a, b) => a + b, 0) / placeRanks.length).toFixed(1)}위` : "수집 전", href: `${base}/place${q}` });
  if (s.column) cards.push({ label: "홈페이지 칼럼", value: String(content.columns.length), unit: s.column.target ? `/ ${s.column.target}건` : "건", foot: "SEO · AEO용 칼럼", href: `${base}/blog${q}&tab=column` });
  if (s.cafe) cards.push({ label: "카페 바이럴", value: String(content.cafe.length), unit: "건", foot: `조회 ${content.cafe.reduce((a, x) => a + (x.views ?? 0), 0).toLocaleString("ko-KR")}`, href: `${base}/cafe${q}` });
  if (s.cardnews) cards.push({ label: "SNS 카드뉴스", value: String(content.cardnews.length), unit: "회차", foot: `배포 링크 ${content.cardnews.reduce((a, r) => a + r.links.length, 0)}개`, href: `${base}/sns${q}` });
  return (
    <>
      <div className="grid g-kpi">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="card kpi"><div className="label">{c.label}</div><div className="value num">{c.value}<small>{c.unit}</small></div><div className="foot">{c.foot}</div></Link>
        ))}
      </div>
      {cards.length === 0 && <div className="empty-state">계약 항목이 아직 설정되지 않았습니다.</div>}
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
