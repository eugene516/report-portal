// 직원 초대 (오너·관리자)
import { requireAdmin } from "@/lib/auth";
import { getStaffOverview } from "@/lib/dashboard";
import InviteManager from "./InviteManager";

export const metadata = { title: "직원 초대 · 리포트 포털" };
export const dynamic = "force-dynamic";

export default async function InvitePage() {
  const me = await requireAdmin();
  const staff = await getStaffOverview();
  return (
    <div className="ops">
      <h1>직원 초대</h1>
      <p className="muted">직원 이메일을 입력하면 계정이 바로 만들어지고 초대 링크와 임시 비밀번호가 발급됩니다. 복사해서 직원에게 전달하면, 직원은 바로 로그인한 뒤 새 비밀번호로 바꿉니다.</p>
      <InviteManager staff={staff} meId={me.userId} />
    </div>
  );
}
