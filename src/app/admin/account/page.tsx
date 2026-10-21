import { requireStaff } from "@/lib/auth";
import PasswordForm from "./PasswordForm";

export const metadata = { title: "내 계정 · 리포트 포털" };

export default async function AccountPage() {
  const staff = await requireStaff();
  return (
    <div className="ops">
      <h1>내 계정</h1>
      <p className="muted">{staff.email} · {staff.role === "admin" ? "관리자" : "직원"}</p>
      <section className="card pad mt narrow">
        <h2>비밀번호 변경</h2>
        <p className="faint">10자 이상, 영문 대문자 · 소문자 · 숫자를 모두 포함해야 합니다. 다른 사이트와 같은 비밀번호는 쓰지 마세요.</p>
        <PasswordForm />
      </section>
    </div>
  );
}
