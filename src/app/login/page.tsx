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
        <p className="muted">관리자가 등록한 직원 계정으로 로그인하세요. 계정이 없으면 관리자에게 요청해 주세요.</p>
        {error && <div className="notice">로그인 정보가 만료되었습니다. 다시 로그인해 주세요.</div>}
        <LoginForm />
      </div>
    </main>
  );
}
