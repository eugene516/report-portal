// 직원 권한 확인 (서버 전용)
// 화면 표시 여부가 아니라 서버에서 매 요청마다 확인한다. 실제 데이터 접근은 DB의 RLS·함수가 한 번 더 막는다.
import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { supabaseForStaff } from "./supabase/server";

export type Staff = { userId: string; email: string; role: "owner" | "admin" | "staff"; name: string; jobTitle: string | null; mustChangePassword: boolean };
export const isAdminRole = (r: Staff["role"]) => r === "owner" || r === "admin";

// 한 요청 안에서는 한 번만 확인한다 (레이아웃·페이지가 같은 결과를 공유).
// getClaims: 로그인 토큰의 서명(ES256)을 서버에서 직접 검증 → 인증 서버 왕복 없음.
// 비활성화된 직원은 직원 명단(staff_roles)에서 지워지므로 아래 조회에서 바로 막힌다.
export const getStaff = cache(async (): Promise<Staff | null> => {
  const supabase = await supabaseForStaff();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data } = await supabase.from("staff_roles").select("role, email, display_name, job_title, must_change_password").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  return { userId, email: data.email, role: data.role, name: data.display_name ?? data.email.split("@")[0], jobTitle: data.job_title ?? null, mustChangePassword: !!data.must_change_password };
});

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
