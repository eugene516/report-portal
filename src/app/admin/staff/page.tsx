// 직원 · 권한 관리 (오너·관리자)
import { requireAdmin } from "@/lib/auth";
import { getStaffOverview } from "@/lib/dashboard";
import StaffManager from "./StaffManager";

export const metadata = { title: "직원 · 권한 관리 · 리포트 포털" };
export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const me = await requireAdmin();
  const staff = await getStaffOverview();
  return (
    <div className="ops">
      <h1>직원 · 권한 관리</h1>
      <p className="muted">오너는 1명이며 오너 권한은 양도로만 바꿀 수 있습니다. 관리자는 전체 광고주와 직원 현황을 볼 수 있고, 직원은 본인이 담당하는 광고주만 볼 수 있습니다.</p>
      <StaffManager staff={staff} me={{ id: me.userId, role: me.role }} />
    </div>
  );
}
