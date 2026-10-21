import Link from "next/link";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  return (
    <>
      <header className="admin-bar">
        <div className="row">
          <Link href="/admin" className="admin-brand">리포트 포털</Link>
          <span className="faint">믿는구석 · 내부용</span>
        </div>
        <div className="row">
          {(staff.role === "owner" || staff.role === "admin") && <Link href="/admin/settings/naver-keys" className="btn sm">API 키 현황</Link>}
          <Link href="/admin/account" className="faint">{staff.name} ({{ owner: "오너", admin: "관리자", staff: "직원" }[staff.role]})</Link>
          <form action="/auth/signout" method="post"><button className="btn sm">로그아웃</button></form>
        </div>
      </header>
      {children}
    </>
  );
}
