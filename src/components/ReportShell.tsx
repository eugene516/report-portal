// 광고주 리포트 공통 틀 (서버 컴포넌트)
// - 같은 화면을 직원 경로(/admin/clients/...)와 광고주 경로(/r/...)가 함께 쓴다.
// - "홈으로 돌아가기"는 직원 경로에서 서버가 직원 권한을 확인한 경우에만 그린다.
//   이 컴포넌트는 서버에서만 렌더링되므로, 광고주 링크 페이지의 HTML·스크립트에는 버튼이 아예 포함되지 않는다.
// - 온라인 광고 하위 메뉴는 <details>로 펼친다 (스크립트 불필요).
import Link from "next/link";
import type { ClientSummary } from "@/lib/report";

export const AD_CHANNELS = [
  { id: "naver", label: "네이버 광고" },
  { id: "daangn", label: "당근마켓 광고" },
  { id: "kakao", label: "카카오 광고" },
] as const;
export type AdChannelId = (typeof AD_CHANNELS)[number]["id"];

const MENUS = [
  { id: "", label: "대시보드" },
  { id: "blog", label: "블로그 · 콘텐츠" },
  { id: "place", label: "플레이스 순위" },
  { id: "cafe", label: "카페 · 바이럴" },
  { id: "sns", label: "SNS 카드뉴스" },
];

export function isActiveChannel(client: ClientSummary, ch: AdChannelId) {
  const s = client.channels[ch];
  return !!(s?.contracted && s?.apiConnected);
}

export default function ReportShell({
  client, base, section, title, eyebrow, showHome, children,
}: {
  client: ClientSummary; base: string; section: string[]; title: string; eyebrow: string; showHome: boolean; children: React.ReactNode;
}) {
  const current = section.join("/");
  const inAds = section[0] === "ads";
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="name">{client.name}</div>
          <div className="sub">{[client.category, client.area].filter(Boolean).join(" · ")}</div>
        </div>
        <nav className="nav">
          {MENUS.map((m) => (
            <Link key={m.id} href={m.id ? `${base}/${m.id}` : base} className={current === m.id ? "on" : ""}>{m.label}</Link>
          ))}
          <details open={inAds} className="nav-group">
            <summary className={`nav-parent ${inAds ? "on" : ""}`}>온라인 광고<span className="chev" aria-hidden="true">▾</span></summary>
            <div className="subnav">
              {AD_CHANNELS.map((ch) => {
                const active = isActiveChannel(client, ch.id);
                const tag = client.channels[ch.id]?.contracted ? "연결 전" : "미집행";
                return (
                  <Link key={ch.id} href={`${base}/ads/${ch.id}`} className={`${current === `ads/${ch.id}` ? "on" : ""} ${active ? "" : "off"}`}>
                    {ch.label}{!active && <span className="cnt">{tag}</span>}
                  </Link>
                );
              })}
            </div>
          </details>
        </nav>
        {showHome && (
          <div className="side-foot">
            <Link href="/admin" className="btn home-btn">← 홈으로 돌아가기</Link>
            <div className="faint">믿는구석 직원에게만 보이는 버튼입니다</div>
          </div>
        )}
      </aside>
      <main className="main">
        <div className="topbar">
          <div className="title"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1></div>
        </div>
        {children}
      </main>
    </div>
  );
}
