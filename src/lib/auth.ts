// 직원 권한 확인 (서버 전용)
// 화면 표시 여부가 아니라 서버에서 매 요청마다 확인한다. 실제 데이터 접근은 DB의 RLS·함수가 한 번 더 막는다.
import "server-only";
import { redirect } from "next/navigation";
import { supabaseForStaff } from "./supabase/server";

export type Staff = { userId: string; email: string; role: "owner" | "admin" | "staff"; name: string };
export const isAdminRole = (r: Staff["role"]) => r === "owner" || r === "admin";

export async function getStaff(): Promise<Staff | null> {
  const supabase = await supabaseForStaff();
  const { data: { user } } = await supabase.auth.getUser();   // 서버에서 토큰을 검증하는 호출
  if (!user) return null;
  const { data } = await supabase.from("staff_roles").select("role, email, display_name").eq("user_id", user.id).maybeSingle();
  if (!data) return null;
  return { userId: user.id, email: data.email, role: data.role, name: data.display_name ?? data.email.split("@")[0] };
}

export async function requireStaff(): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  return staff;
}

export async function requireAdmin(): Promise<Staff> {
  const staff = await requireStaff();
  if (!isAdminRole(staff.role)) redirect("/admin?denied=1");
  return staff;
}
