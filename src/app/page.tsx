import { redirect } from "next/navigation";

// 첫 화면은 직원 대시보드로 보낸다 (로그인하지 않았으면 /login 으로 이동)
export default function Home() {
  redirect("/admin");
}
