// 광고주 링크 발급 현황 (서버 전용). 링크 원문은 저장하지 않으므로 발급 여부·시각·최근 접속만 보여준다.
import "server-only";
import { supabaseForStaff } from "./supabase/server";

export type LinkStatus = { active: number; issuedAt: string | null; lastUsedAt: string | null; expiresAt?: string | null };

// RLS: 담당·관리자 광고주의 링크만 조회된다
export async function getLinkStatus(clientIds?: string[]): Promise<Map<string, LinkStatus>> {
  const db = await supabaseForStaff();
  let q = db.from("client_access_tokens").select("client_id, created_at, last_used_at, expires_at, revoked_at").is("revoked_at", null);
  if (clientIds) q = q.in("client_id", clientIds);
  const { data } = await q;
  const now = Date.now();
  const out = new Map<string, LinkStatus>();
  for (const t of data ?? []) {
    if (t.expires_at && Date.parse(t.expires_at) < now) continue;
    const s = out.get(t.client_id) ?? { active: 0, issuedAt: null, lastUsedAt: null, expiresAt: null };
    // 가장 늦게 끝나는 링크 기준 (무기한 링크가 있으면 null)
    if (s.active === 0) s.expiresAt = t.expires_at; else if (s.expiresAt && (!t.expires_at || t.expires_at > s.expiresAt)) s.expiresAt = t.expires_at;
    s.active += 1;
    if (!s.issuedAt || t.created_at > s.issuedAt) s.issuedAt = t.created_at;
    if (t.last_used_at && (!s.lastUsedAt || t.last_used_at > s.lastUsedAt)) s.lastUsedAt = t.last_used_at;
    out.set(t.client_id, s);
  }
  return out;
}

export const kstShort = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ").replace("-", "/");
