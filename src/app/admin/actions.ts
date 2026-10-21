"use server";
// 관리자 서버 액션: 광고주 전용 링크 발급
// - 토큰은 서버에서 무작위로 만들고, DB에는 SHA-256 해시만 저장한다 (RLS: 관리자만 insert 가능).
// - 원문 토큰은 발급 직후 한 번만 화면에 보여준다. 다시 조회할 수 없다.
import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";

export async function issueClientLink(clientId: string): Promise<{ url?: string; error?: string }> {
  const admin = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/.test(clientId)) return { error: "잘못된 요청입니다." };
  const token = randomBytes(32).toString("base64url"); // 43자, 256비트
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = await supabaseForStaff();
  const { error } = await db.from("client_access_tokens").insert({ client_id: clientId, token_hash: tokenHash, label: "관리자 발급", created_by: admin.userId });
  if (error) return { error: "링크를 발급하지 못했습니다." };
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return { url: `${proto}://${h.get("host")}/r/${token}` };
}
