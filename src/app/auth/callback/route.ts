// 이메일 로그인 링크를 누르면 오는 곳: 코드를 세션으로 바꾸고 직원 화면으로 보낸다.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseForStaff } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await supabaseForStaff();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/admin", request.url));
  }
  return NextResponse.redirect(new URL("/login?error=1", request.url));
}
