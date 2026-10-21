// 서버 전용 Supabase 클라이언트
// - 직원 화면: 로그인 쿠키를 실어 보내므로 DB의 RLS·권한 확인이 그대로 적용된다.
// - 광고주 화면: 쿠키 없이 공개 키로만 호출하고, 토큰 검증은 DB 함수(report_*)가 한다.
// 웹 서버에는 공개 키만 있다. 관리자 키(service_role)·암호화 마스터키는 두지 않는다.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function supabaseForStaff() {
  const cookieStore = await cookies();
  return createServerClient(URL, KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 proxy.ts 가 맡는다.
        }
      },
    },
  });
}

export function supabaseForClientLink() {
  return createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
