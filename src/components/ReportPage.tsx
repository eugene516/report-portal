// 광고주 리포트 페이지 본문 (직원 경로·광고주 경로 공용, 서버 컴포넌트)
import Link from "next/link";
import { notFound } from "next/navigation";
import { basePath, getClientSummary, getNaverReport, resolvePeriod, type ReportCtx } from "@/lib/report";
import ReportShell, { AD_CHANNELS, isActiveChannel, type AdChannelId } from "./ReportShell";
import NaverAdsView from "./NaverAdsView";

const TITLES: Record<string, string> = {
  "": "대시보드", blog: "블로그 · 콘텐츠", place: "플레이스 순위", cafe: "카페 · 바이럴", sns: "SNS 카드뉴스",
};

export default async function ReportPage({
  ctx, section, searchParams, showHome,
}: { ctx: ReportCtx; section: string[]; searchParams: Record<string, string | undefined>; showHome: boolean }) {
  const client = await getClientSummary(ctx);
  if (!client) notFound();   // 틀린 링크·권한 없음: 존재 여부를 구분하지 않는다
  const base = basePath(ctx);
  const key = section.join("/");

  let title = TITLES[key];
  let body: React.ReactNode;

  if (section[0] === "ads") {
    const ch = AD_CHANNELS.find((c) => c.id === section[1]);
    if (!ch || section.length !== 2) notFound();
    title = ch.label;
    body = await adsBody(ctx, client, ch.id, ch.label, `${base}/ads/${ch.id}`, searchParams);
  } else if (title === undefined) {
    notFound();
  } else if (key === "") {
    body = <Dashboard client={client} base={base} />;
  } else {
    body = <div className="empty-state"><b>{title}</b>기존 엑셀 리포트·시안 데이터를 옮겨 오는 중입니다.</div>;
  }

  return (
    <ReportShell client={client} base={base} section={section} title={title} eyebrow={`${client.name} 마케팅 리포트${section[0] === "ads" ? " · 온라인 광고" : ""}`} showHome={showHome}>
      {body}
    </ReportShell>
  );
}

async function adsBody(ctx: ReportCtx, client: Awaited<ReturnType<typeof getClientSummary>> & object, ch: AdChannelId, label: string, path: string, sp: Record<string, string | undefined>) {
  const state = client.channels[ch];
  if (!state?.contracted) {
    return (
      <div className="empty-state off-state">
        <b>{label}는 집행되지 않는 광고입니다.</b>
        계약된 광고가 아니어서 표시할 성과가 없습니다.
        <OtherChannels client={client} current={ch} path={path} />
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
  return <NaverAdsView data={data} period={period} path={path} />;
}

function OtherChannels({ client, current, path }: { client: { channels: Record<string, { contracted: boolean; apiConnected: boolean } | undefined> }; current: AdChannelId; path: string }) {
  const others = AD_CHANNELS.filter((c) => c.id !== current && client.channels[c.id]?.contracted && client.channels[c.id]?.apiConnected);
  if (!others.length) return null;
  const base = path.replace(/\/ads\/[^/]+$/, "");
  return (
    <div className="row mt" style={{ justifyContent: "center" }}>
      {others.map((o) => <Link key={o.id} className="btn" href={`${base}/ads/${o.id}`}>{o.label} 성과 보기</Link>)}
    </div>
  );
}

function Dashboard({ client, base }: { client: { channels: Record<string, { contracted: boolean; apiConnected: boolean } | undefined> }; base: string }) {
  return (
    <>
      <h2>온라인 광고</h2>
      <div className="grid g-3 mt">
        {AD_CHANNELS.map((c) => {
          const s = client.channels[c.id];
          const status = !s?.contracted ? ["미집행", ""] : s.apiConnected ? ["성과 연결됨", "good"] : ["연결 준비 중", "warn"];
          return (
            <Link key={c.id} href={`${base}/ads/${c.id}`} className={`card kpi ${s?.contracted ? "" : "empty"}`}>
              <div className="label">{c.label}</div>
              <div className="row mt-s"><span className={`badge ${status[1]}`}>{status[0]}</span></div>
            </Link>
          );
        })}
      </div>
      <div className="planned mt-l">블로그 · 플레이스 · 카페 · 카드뉴스 리포트는 기존 엑셀·시안 데이터를 옮겨 오는 중입니다.</div>
    </>
  );
}
