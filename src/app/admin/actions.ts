"use server";
// 서버 액션: 광고주 전용 링크 발급 (관리자 또는 해당 광고주 담당 직원 — DB 규칙이 담당 여부를 확인)
// - 토큰은 서버에서 무작위로 만들고, DB에는 SHA-256 해시만 저장한다 (RLS: can_access_client 인 경우만 insert 가능).
// - 원문 토큰은 발급 직후 한 번만 화면에 보여준다. 다시 조회할 수 없다.
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { requireStaff } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";

export async function issueClientLink(clientId: string, months = 0): Promise<{ url?: string; error?: string }> {
  const staff = await requireStaff();
  if (!/^[0-9a-f-]{36}$/.test(clientId)) return { error: "잘못된 요청입니다." };
  const token = randomBytes(32).toString("base64url"); // 43자, 256비트
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = await supabaseForStaff();
  // 사용 기간: 0 = 무기한, 3·6·12개월
  const m = [0, 3, 6, 12].includes(months) ? months : 0;
  const expires = m ? new Date(Date.now() + m * 30.5 * 86_400_000).toISOString() : null;
  const { error } = await db.from("client_access_tokens").insert({ client_id: clientId, token_hash: tokenHash, label: "관리자 발급", created_by: staff.userId, expires_at: expires });
  if (error) return { error: "링크를 발급하지 못했습니다." };
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return { url: `${proto}://${h.get("host")}/r/${token}` };
}
