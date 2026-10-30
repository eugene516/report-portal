"use client";
// 업무관리 상단 탭: 할일 · 문의관리
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/tasks", label: "할일" },
  { href: "/admin/tasks/inquiries", label: "문의관리" },
];

export default function WorkTabs() {
  const path = usePathname();
  const cur = path.startsWith("/admin/tasks/inquiries") ? "/admin/tasks/inquiries" : "/admin/tasks";
  return (
    <nav className="tabs work-tabs" aria-label="업무관리">
      {TABS.map((t) => <Link key={t.href} href={t.href} className={t.href === cur ? "on" : ""} aria-current={t.href === cur ? "page" : undefined}>{t.label}</Link>)}
    </nav>
  );
}
