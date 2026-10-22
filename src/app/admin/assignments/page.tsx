// 광고주별 담당 직원 관리 (오너·관리자)
import { requireAdmin } from "@/lib/auth";
import { getStaffOverview } from "@/lib/dashboard";
import { supabaseForStaff } from "@/lib/supabase/server";
import AssignmentManager from "./AssignmentManager";

export const metadata = { title: "광고주별 담당 직원 · 리포트 포털" };
export const dynamic = "force-dynamic";

export default async function AssignmentsPage() {
  await requireAdmin();
  const db = await supabaseForStaff();
  const [clients, assign, staff] = await Promise.all([
    db.from("clients").select("id, name, category, area").order("name"),
    db.from("client_staff").select("client_id, user_id, is_primary"),
    getStaffOverview(),
  ]);
  const rows = (clients.data ?? []).map((c) => {
    const mine = (assign.data ?? []).filter((a) => a.client_id === c.id);
    return { ...c, primary: mine.find((a) => a.is_primary)?.user_id ?? null, support: mine.filter((a) => !a.is_primary).map((a) => a.user_id) };
  });
  return (
    <div className="ops">
      <h1>광고주별 담당 직원</h1>
      <p className="muted">광고주마다 주담당 1명과 보조 담당을 정합니다. 직원은 배정된 광고주만 볼 수 있으며, 변경은 저장 즉시 반영됩니다.</p>
      <AssignmentManager clients={rows} staff={staff.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role }))} />
    </div>
  );
}
