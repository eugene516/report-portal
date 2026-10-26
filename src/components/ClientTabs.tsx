// 광고주 한 곳의 내부 화면을 탭으로 묶는다: 진행 현황 · 리포트 · 계약 · 견적 · 설정 · 데이터 업로드 · 변경 이력(관리자)
// 서버에서만 그린다(직원 경로 전용). 광고주 링크 화면에는 나오지 않는다.
import Link from "next/link";
import { getInHouseIds } from "@/lib/month";

export type ClientTab = "progress" | "report" | "review" | "contracts" | "settings" | "upload" | "activity";

export default async function ClientTabs({ clientId, current, isAdmin = false }: { clientId: string; current: ClientTab; isAdmin?: boolean }) {
  const base = `/admin/clients/${clientId}`;
  const inHouse = (await getInHouseIds()).has(clientId);   // 자사 마케팅은 계약 없이 항목만
  const tabs: { id: ClientTab; label: string; href: string }[] = [
    { id: "progress", label: "진행 현황", href: `/admin/progress/${clientId}` },
    { id: "report", label: "리포트", href: base },
    { id: "review", label: "파일 검수", href: `${base}/review` },
    { id: "contracts", label: inHouse ? "업무 항목" : "계약 · 견적", href: `${base}/contracts` },
    { id: "settings", label: "설정", href: `${base}/settings` },
    { id: "upload", label: "데이터 업로드", href: `${base}/upload` },
    ...(isAdmin ? [{ id: "activity" as const, label: "변경 이력", href: `/admin/activity?client=${clientId}` }] : []),
  ];
  return (
    <nav className="client-tabs" aria-label="광고주 메뉴">
      {tabs.map((t) => <Link key={t.id} href={t.href} className={t.id === current ? "on" : ""} aria-current={t.id === current ? "page" : undefined}>{t.label}</Link>)}
    </nav>
  );
}
