// 내 정보 수정 (모든 직원)
import { requireStaff } from "@/lib/auth";
import PasswordForm from "./PasswordForm";
import ProfileForm from "./ProfileForm";

export const metadata = { title: "내 정보 수정 · 리포트 포털" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const staff = await requireStaff({ allowPendingPassword: true });
  return (
    <div className="ops">
      <h1>내 정보 수정</h1>
      {staff.mustChangePassword && (
        <div className="notice mt">임시 비밀번호로 로그인했습니다. 아래에서 새 비밀번호로 바꾸면 리포트 포털을 이용할 수 있습니다.</div>
      )}
      <section className="card pad mt narrow">
        <h2>기본 정보</h2>
        <ProfileForm email={staff.email} name={staff.name} role={{ owner: "오너", admin: "관리자", staff: "직원" }[staff.role]} />
      </section>
      <section className="card pad mt narrow">
        <h2>비밀번호 변경</h2>
        <p className="faint">10자 이상, 영문 대문자 · 소문자 · 숫자를 모두 포함해야 합니다. 다른 사이트와 같은 비밀번호는 쓰지 마세요.</p>
        <PasswordForm email={staff.email} first={staff.mustChangePassword} />
      </section>
    </div>
  );
}
