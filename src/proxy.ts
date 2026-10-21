// Next.js 16 proxy (구 middleware)
// - 직원 화면(/admin, /auth): 로그인 세션 쿠키를 갱신한다.
// - 광고주 링크(/r/...): 토큰이 다른 사이트로 새지 않도록 Referrer 를 막고, 검색엔진 수집을 막는다.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const res = NextResponse.next({ request });

  if (request.nextUrl.pathname.startsWith("/r/")) {
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    res.headers.set("Cache-Control", "private, no-store");
    return res;
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
  await supabase.auth.getUser(); // 세션 갱신
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/auth/:path*", "/login", "/r/:path*"],
};
