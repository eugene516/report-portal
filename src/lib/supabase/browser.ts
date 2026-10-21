"use client";
// 브라우저용 Supabase 클라이언트 (공개 키만 사용)
// 관리자 키 등록 화면은 이 클라이언트로 Supabase 수집 작업(naver-key-admin)을 직접 호출한다.
// 그래서 광고주 API 키는 웹 서버(Vercel)를 거치지 않는다.
import { createBrowserClient } from "@supabase/ssr";

export function supabaseBrowser() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
