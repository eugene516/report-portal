// 광고주 리포트 공통 틀 (서버 컴포넌트)
// - 같은 화면을 직원 경로(/admin/clients/...)와 광고주 경로(/r/...)가 함께 쓴다.
// - 좌측 메뉴는 계약 항목(client_services)에 따라 구성한다. 온라인 광고는 항상 표시(미계약은 안내).
// - 리포트는 당월 내용만 기본으로 보여주고, 지난 달은 "지난 레포트 보기"에서 골라 연다(?period=YYYY-MM).
// - "계약 · 견적 관리"는 직원 경로에서만 그린다.
// - "홈으로 돌아가기", "설정", "데이터 업로드"는 직원 경로에서 서버가 권한을 확인한 경우에만 그린다.
//   서버에서만 렌더링되므로 광고주 링크 페이지의 HTML·스크립트에는 포함되지 않는다.
import Link from "next/link";
import { Fragment } from "react";
import type { ClientSummary } from "@/lib/report";
import { logoUrl } from "@/lib/logo";
import LogoEditor from "./LogoEditor";
import ClientTabs from "./ClientTabs";
import PrintButton from "./PrintButton";
import IssueLinkButton from "@/app/admin/IssueLinkButton";
import { kstShort, type LinkStatus } from "@/lib/links";

export const AD_CHANNELS = [
  { id: "naver", label: "네이버 광고" },
  { id: "daangn", label: "당근마켓 광고" },
  { id: "kakao", label: "카카오 광고" },
] as const;
export type AdChannelId = (typeof AD_CHANNELS)[number]["id"];

// fixed: 계약 여부와 관계없이 항상 보이는 메뉴 (계약하지 않았으면 "미집행"으로 표시하고, 중간에 계약하면 바로 진행)
// svc: 이 메뉴의 계약 항목(client_services.service)
export const MENUS = [
  { id: "", label: "대시보드", svc: null, fixed: true },
  { id: "blog", label: "블로그", svc: "blog", fixed: true },
  { id: "column", label: "홈페이지 칼럼", svc: "column", fixed: true },
  { id: "place", label: "플레이스 순위", svc: "place", fixed: true },
  { id: "cafe", label: "카페 바이럴", svc: "cafe", fixed: true },
  { id: "daangn", label: "당근마켓 바이럴", svc: "daangn", fixed: true },
  { id: "sns", label: "SNS 카드뉴스", svc: "cardnews", fixed: true },
] as const;
export type MenuId = (typeof MENUS)[number]["id"];

export function isActiveChannel(client: ClientSummary, ch: AdChannelId) {
  const s = client.channels[ch];
  return !!(s?.contracted && s?.apiConnected);
}

export function visibleMenus(services: string[]) {
  return MENUS.filter((m) => m.fixed || (m.svc && services.includes(m.svc)));
}
export const isContracted = (services: string[], svc: string | null) => !svc || services.includes(svc);

export default function ReportShell({
  client, base, section, title, eyebrow, staffTools, preview = null, link = null, reviewPending = 0, inHouse = false, services, period, thisMonth, children,
}: {
  client: ClientSummary; base: string; section: string[]; title: string; eyebrow: string;
  staffTools: boolean; services: string[]; period: string; thisMonth: string; children: React.ReactNode;
  preview?: string | null;   // 광고주 화면 미리보기 중이면 내부 화면 주소(돌아가기용)
  link?: LinkStatus | null;  // 직원 화면 · 미리보기: 광고주 링크 발급 현황
  reviewPending?: number;    // 파일 검수 대기 건수 (0이면 배지 숨김)
  inHouse?: boolean;         // 자사 마케팅: '계약 · 견적 관리' 대신 '업무 항목 관리'
}) {
  const current = section.join("/");
  const inAds = section[0] === "ads";
  const tool = current === "history" || current === "contracts" || section[0] === "review";
  const past = period !== thisMonth && !inAds && !tool;
  const q = past ? `?period=${period}` : "";
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          {/* 로고: 직원 화면은 눌러서 등록·변경, 광고주 링크는 등록된 경우에만 표시 */}
          {staffTools ? <LogoEditor clientId={client.id} name={client.name} current={client.logo ?? null} />
            // eslint-disable-next-line @next/next/no-img-element
            : client.logo && <img className="brand-logo" src={logoUrl(client.logo)} alt={`${client.name} 로고`} />}
          <div className="brand-t">
            <div className="name">{client.name}</div>
            <div className="sub">{[client.category, client.area].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <nav className="nav">
          {visibleMenus(services).map((m) => (
            <Fragment key={m.id}>
              <Link href={`${m.id ? `${base}/${m.id}` : base}${q}`} className={`${current === m.id ? "on" : ""} ${isContracted(services, m.svc) ? "" : "off"}`}>
                {m.label}{!isContracted(services, m.svc) && <span className="cnt">미집행</span>}
              </Link>
              {/* 대시보드 바로 아래: 파일 검수 (대기 건수) */}
              {m.id === "" && (
                <Link href={`${base}/review`} className={section[0] === "review" ? "on" : ""}>
                  파일 검수{reviewPending > 0 && <span className="cnt review-cnt">{reviewPending}건 대기</span>}
                </Link>
              )}
            </Fragment>
          ))}
          <details open className="nav-group">
            <summary className={`nav-parent ${inAds ? "on" : ""}`}>온라인 광고<span className="chev" aria-hidden="true">▾</span></summary>
            <div className="subnav">
              {AD_CHANNELS.map((ch) => {
                const active = isActiveChannel(client, ch.id);
                const contracted = !!client.channels[ch.id]?.contracted;
                const tag = contracted ? "연결 전" : "미집행";
                // 네이버 광고는 파워링크 · 플레이스 광고 두 하위 메뉴
                if (ch.id === "naver") return (
                  <div key={ch.id} className="subnav-group">
                    <span className={`subnav-h ${contracted ? "" : "off"}`}>{ch.label}{!contracted && <span className="cnt">미집행</span>}</span>
                    <Link href={`${base}/ads/naver`} className={`sub2 ${current === "ads/naver" ? "on" : ""} ${active ? "" : "off"}`}>파워링크 광고{contracted && !active && <span className="cnt">연결 전</span>}</Link>
                    <Link href={`${base}/ads/naver/place`} className={`sub2 ${current === "ads/naver/place" ? "on" : ""} ${contracted ? "" : "off"}`}>플레이스 광고</Link>
                  </div>
                );
                return (
                  <Link key={ch.id} href={`${base}/ads/${ch.id}`} className={`${current === `ads/${ch.id}` ? "on" : ""} ${active ? "" : "off"}`}>
                    {ch.label}{!active && <span className="cnt">{tag}</span>}
                  </Link>
                );
              })}
            </div>
          </details>
          <div className="nav-div" />
          <Link href={`${base}/history`} className={current === "history" || past ? "on" : ""}>지난 레포트 보기</Link>
          {staffTools && <Link href={`${base}/contracts`} className={current === "contracts" ? "on" : ""}>{inHouse ? "업무 항목 관리" : "계약 · 견적 관리"}<span className="cnt">직원용</span></Link>}
        </nav>
        {staffTools && (
          <div className="side-foot">
            <Link href={`/admin/clients/${client.id}/settings`} className="btn sm">광고주 설정</Link>
            <Link href={`/admin/clients/${client.id}/upload`} className="btn sm">데이터 업로드</Link>
            <Link href="/admin" className="btn home-btn">← 홈으로 돌아가기</Link>
            <div className="faint">믿는구석 직원에게만 보이는 메뉴입니다</div>
          </div>
        )}
      </aside>
      <main className="main">
        {staffTools && <ClientTabs clientId={client.id} current={current === "contracts" ? "contracts" : section[0] === "review" ? "review" : "report"} />}
        {preview && (
          <div className="preview-bar">
            <span><b>광고주 화면 미리보기</b> · 광고주가 링크로 보는 화면과 같습니다</span>
            <span className="row">
              {link && <LinkState link={link} />}
              <IssueLinkButton clientId={client.id} issued={!!link?.active} primary />
              <Link href={`${preview}${current ? `/${current}` : ""}${q}`} className="btn sm">← 내부 화면으로 돌아가기</Link>
            </span>
          </div>
        )}
        <div className="topbar">
          <div className="title"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1></div>
          {!staffTools && current !== "full" && <PrintButton />}
          {staffTools && (
            <div className="row topbar-tools">
            {link && <LinkState link={link} />}
            <Link href={`${base}/preview${current && current !== "contracts" ? `/${current}` : ""}${q}`} className="btn sm preview-btn" title="광고주에게 보내는 링크로 열었을 때와 같은 화면">
              <span aria-hidden="true">👁</span> 광고주 화면 미리보기
            </Link>
            <PrintButton />
            </div>
          )}
          {past && (
            <div className="row">
              <span className="badge warn">지난 레포트 · {period.replace("-", "년 ")}월</span>
              <Link href={`${base}/history`} className="btn sm">다른 달 보기</Link>
              <Link href={current ? `${base}/${current}` : base} className="btn sm primary">이번 달로 돌아가기</Link>
            </div>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}

// 만료 2주 이내
const expSoon = (iso: string) => Date.parse(iso) - Date.parse(new Date().toISOString()) < 14 * 86_400_000;

// 광고주 링크 발급 현황 (링크 원문은 발급할 때 한 번만 보이고 저장하지 않는다)
function LinkState({ link }: { link: LinkStatus }) {
  if (!link.active) return <span className="badge warn" title="광고주에게 보낼 링크가 아직 없습니다">광고주 링크 미발급</span>;
  return (
    <span className="badge good link-state" title={`사용 중인 링크 ${link.active}개 · 링크 확인·폐기는 광고주 설정에서`}>
      ✓ 링크 발급 완료 · {kstShort(link.issuedAt!)}{link.lastUsedAt ? ` · 최근 열람 ${kstShort(link.lastUsedAt)}` : " · 아직 열람 전"}
      {link.expiresAt && <span className={Date.parse(link.expiresAt) - Date.parse(link.issuedAt!) > 0 && expSoon(link.expiresAt) ? "exp-soon" : ""}> · {kstShort(link.expiresAt).slice(0, 5)} 만료</span>}
    </span>
  );
}
