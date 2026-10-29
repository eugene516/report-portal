// 광고주 링크 발급 · 다시 보기 (그 광고주의 담당 직원 · 오너 · 관리자)
// - issue: 무작위 토큰을 만들고 DB에는 SHA-256 해시(접속 확인용)와 암호문(다시 보기용)만 저장한다
// - reveal: 사용 중인 링크의 토큰을 복호화해 돌려준다 (tokenId 를 주면 그 링크, 없으면 가장 최근 링크)
// 마스터키는 Supabase 비밀값 ENCRYPTION_KEY 에만 있다. 토큰 원문은 로그에 남기지 않는다.
import { decryptText, encryptText } from "../_shared/crypto.ts";
import { errorMessage, log } from "../_shared/log.ts";
import { corsHeaders, getCaller, json, serviceClient, withCors } from "../_shared/common.ts";

const UUID = /^[0-9a-f-]{36}$/;
const PURPOSE = "client-link";
const toB64Url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256Hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const reply = (body: unknown, status = 200) => withCors(req, json(body, status));
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller) return reply({ error: "forbidden" }, 403);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "invalid body" }, 400); }
  const clientId = String(body.clientId ?? "");
  if (!UUID.test(clientId) || !(await caller.canAccess(clientId))) return reply({ error: "forbidden" }, 403);
  const db = serviceClient();
  const action = String(body.action ?? "");

  if (action === "issue") {
    // 사용 기간: 0 = 무기한, 3·6·12개월
    const months = [0, 3, 6, 12].includes(Number(body.months)) ? Number(body.months) : 0;
    const token = toB64Url(crypto.getRandomValues(new Uint8Array(32)));   // 43자, 256비트
    const expires = months ? new Date(Date.now() + months * 30.5 * 86_400_000).toISOString() : null;
    try {
      const { error } = await db.from("client_access_tokens").insert({
        client_id: clientId, token_hash: await sha256Hex(token), token_enc: await encryptText(token, PURPOSE),
        label: "관리자 발급", created_by: caller.userId, expires_at: expires,
      });
      if (error) throw error;
    } catch (e) {
      log("warn", "client link issue failed", { error: errorMessage(e, [token]) }, [token]);
      return reply({ error: "링크를 발급하지 못했습니다." }, 500);
    }
    log("info", "client link issued", { by: caller.userId, client: clientId });
    return reply({ token });
  }

  if (action === "reveal") {
    const tokenId = body.tokenId ? String(body.tokenId) : null;
    if (tokenId && !UUID.test(tokenId)) return reply({ error: "invalid tokenId" }, 400);
    let q = db.from("client_access_tokens").select("id, token_enc, expires_at").eq("client_id", clientId).is("revoked_at", null).not("token_enc", "is", null);
    if (tokenId) q = q.eq("id", tokenId);
    const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!data || (data.expires_at && new Date(data.expires_at) < new Date())) return reply({ error: "다시 볼 수 있는 사용 중 링크가 없습니다. 새로 발급하세요." }, 404);
    try {
      const token = await decryptText(data.token_enc, PURPOSE);
      log("info", "client link revealed", { by: caller.userId, client: clientId, link: data.id });
      return reply({ token });
    } catch (e) {
      log("warn", "client link reveal failed", { error: errorMessage(e) });
      return reply({ error: "링크를 불러오지 못했습니다." }, 500);
    }
  }
  return reply({ error: "unknown action" }, 400);
});
