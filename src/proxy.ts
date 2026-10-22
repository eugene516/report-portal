// Next.js 16 proxy (구 middleware)
// - 직원 화면(/admin, /auth): 로그인 세션 쿠키를 갱신한다.
// - 광고주 링크(/r/...): 토큰이 다른 사이트로 새지 않도록 Referrer 를 막고, 검색엔진 수집을 막는다.
//   파일 검수 로그인(광고주 계정)을 한 경우에는 세션 쿠키도 갱신한다.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const res = NextResponse.next({ request });

  const isLink = request.nextUrl.pathname.startsWith("/r/");
  if (isLink) {
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    // 로그인 쿠키가 없으면(일반 광고주 열람) 세션 확인 없이 바로 보낸다. 파일 검수 로그인을 한 경우에만 세션을 갱신한다
    if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) { res.headers.set("Cache-Control", "private, no-store"); return res; }
  }

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getClaims(); // 세션 갱신 (만료된 토큰만 인증 서버에 갱신 요청)
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/auth/:path*", "/login", "/r/:path*"],
};
