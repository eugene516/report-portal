// 직원 권한 확인 (서버 전용)
// 화면 표시 여부가 아니라 서버에서 매 요청마다 확인한다. 실제 데이터 접근은 DB의 RLS·함수가 한 번 더 막는다.
import "server-only";
import { redirect } from "next/navigation";
import { supabaseForStaff } from "./supabase/server";

export type Staff = { userId: string; email: string; role: "owner" | "admin" | "staff"; name: string; mustChangePassword: boolean };
export const isAdminRole = (r: Staff["role"]) => r === "owner" || r === "admin";

export async function getStaff(): Promise<Staff | null> {
  const supabase = await supabaseForStaff();
  const { data: { user } } = await supabase.auth.getUser();   // 서버에서 토큰을 검증하는 호출
  if (!user) return null;
  const { data } = await supabase.from("staff_roles").select("role, email, display_name, must_change_password").eq("user_id", user.id).maybeSingle();
  if (!data) return null;
  return { userId: user.id, email: data.email, role: data.role, name: data.display_name ?? data.email.split("@")[0], mustChangePassword: !!data.must_change_password };
}

// 임시 비밀번호로 로그인한 직원은 비밀번호를 바꿀 때까지 '내 정보 수정' 화면만 쓸 수 있다.
export async function requireStaff(opts: { allowPendingPassword?: boolean } = {}): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.mustChangePassword && !opts.allowPendingPassword) redirect("/admin/account?first=1");
  return staff;
}

export async function requireAdmin(): Promise<Staff> {
  const staff = await requireStaff();
  if (!isAdminRole(staff.role)) redirect("/admin?denied=1");
  return staff;
}
