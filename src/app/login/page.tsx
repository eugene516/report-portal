import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const metadata = { title: "직원 로그인 · 리포트 포털" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getStaff()) redirect("/admin");
  const { error } = await searchParams;
  return (
    <main className="login-wrap">
      <div className="card pad login-card">
        <div className="faint">믿는구석 · 내부용</div>
        <h1>리포트 포털 직원 로그인</h1>
        <p className="muted">등록된 직원 이메일을 입력하면 로그인 링크를 보내 드립니다.</p>
        {error && <div className="notice">로그인 링크가 만료되었거나 올바르지 않습니다. 다시 요청해 주세요.</div>}
        <LoginForm />
      </div>
    </main>
  );
}
