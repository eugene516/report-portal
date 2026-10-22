import { cookies } from "next/headers";
import { Suspense } from "react";
import { isAdminRole, requireStaff } from "@/lib/auth";
import { getStaffOverview } from "@/lib/dashboard";
import { supabaseForStaff } from "@/lib/supabase/server";
import AdminFrame from "./AdminFrame";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff({ allowPendingPassword: true });   // 화면별 검사는 각 페이지에서
  const isAdmin = isAdminRole(staff.role);
  const navCollapsed = (await cookies()).get("rp_nav")?.value === "c";   // AdminFrame 의 메뉴 접힘 기억
  // 좌측 메뉴: 관리자 = 직원별 담당 업체, 직원 = 내 담당 광고주
  const [staffList, mine] = await Promise.all([
    isAdmin && !staff.mustChangePassword ? getStaffOverview() : Promise.resolve([]),
    !isAdmin && !staff.mustChangePassword
      ? (await supabaseForStaff()).from("client_staff").select("is_primary, clients(id, name)").eq("user_id", staff.userId)
      : Promise.resolve({ data: [] }),
  ]);
  const myClients = ((mine.data ?? []) as unknown as { is_primary: boolean; clients: { id: string; name: string } | null }[])
    .filter((r) => r.clients).map((r) => ({ id: r.clients!.id, name: r.clients!.name, primary: r.is_primary }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return (
    <Suspense>
      <AdminFrame me={{ name: staff.name, role: staff.role, jobTitle: staff.jobTitle }} myClients={myClients} navCollapsed={navCollapsed}
        staff={staffList.map((s) => ({ id: s.id, name: s.name, role: s.role, jobTitle: s.jobTitle, clients: s.clients }))}>
        {children}
      </AdminFrame>
    </Suspense>
  );
}
