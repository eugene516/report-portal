// 수집 작업 공통: Supabase 클라이언트, 호출자 권한 확인, 실패 알림, 한국시간 날짜
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { log, mask } from "./log.ts";

// 서비스 롤 클라이언트: RLS를 우회하므로 이 수집 작업 안에서만 쓴다.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Supabase Edge Function 런타임이 자동으로 넣어 준다.
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Caller = { userId: string; email: string | null; isAdmin: boolean };

// 요청의 로그인 토큰(JWT)으로 사용자를 확인하고, DB의 is_admin()으로 관리자 여부를 판단한다.
export async function getCaller(req: Request): Promise<Caller | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return null;
  const { data: isAdmin } = await userClient.rpc("is_admin");
  return { userId: u.user.id, email: u.user.email ?? null, isAdmin: isAdmin === true };
}

// 예약 실행(pg_cron) 확인: 요청 헤더의 비밀값을 함수 비밀값 CRON_SECRET 과 비교
export function isCronRequest(req: Request): boolean {
  const expected = Deno.env.get("CRON_SECRET");
  const got = req.headers.get("x-cron-secret");
  if (!expected || !got || expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

// 한국시간 기준 날짜 (YYYY-MM-DD). offsetDays=-1 이면 어제
export function kstDate(offsetDays = 0, base = new Date()): string {
  const kst = new Date(base.getTime() + 9 * 3600_000 + offsetDays * 86_400_000);
  return kst.toISOString().slice(0, 10);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// 실패 알림: 담당자 이메일 (Resend). RESEND_API_KEY / ALERT_EMAILS 가 설정되지 않으면 로그만 남긴다.
// 대시보드 표시는 naver_sync_logs(status='failed')를 화면에서 읽어 보여준다.
export async function notifyFailure(subject: string, lines: string[]) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const to = (Deno.env.get("ALERT_EMAILS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const from = Deno.env.get("ALERT_FROM") ?? "report-portal <onboarding@resend.dev>";
  const text = lines.map((l) => mask(l)).join("\n");
  if (!apiKey || to.length === 0) {
    log("warn", "failure alert not sent (email not configured)", { subject });
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) log("error", "failure alert email rejected", { status: res.status });
  } catch {
    log("error", "failure alert email error");
  }
}
