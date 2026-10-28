// 광고주 링크 화면의 이메일 로그인 (비밀번호 · 메일 인증 없음 — 운영 결정 2026-10-28)
// POST { token, email }
// - 링크 토큰을 DB에서 검증하고, 그 광고주에 등록된 이메일(client_users)일 때만 로그인 토큰을 만든다.
// - 메일은 보내지 않는다: 관리자 API로 만든 일회용 토큰(hashed_token)을 돌려주면 브라우저가 verifyOtp 로 세션을 연다.
// - 다른 광고주에 등록된 이메일 · 직원 이메일 · 잘못된 토큰은 구분하지 않고 같은 오류로 막는다.
import { errorMessage, log } from "../_shared/log.ts";
import { corsHeaders, json, serviceClient, withCors } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const reply = (body: unknown, status = 200) => withCors(req, json(body, status));
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "invalid body" }, 400); }
  const token = String(body.token ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  const denied = () => reply({ error: "등록된 이메일이 아닙니다. 담당자에게 확인해 주세요." }, 403);
  if (token.length < 32 || token.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return denied();

  const db = serviceClient();
  const { data: clientId } = await db.rpc("resolve_client_token", { p_token: token });
  if (!clientId) return denied();
  const { data: cu } = await db.from("client_users").select("user_id").eq("client_id", clientId).eq("email", email).maybeSingle();
  if (!cu) return denied();

  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    log("warn", "client link login failed", { error: errorMessage(error) });
    return reply({ error: "로그인하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 500);
  }
  log("info", "client link login", { client: clientId, user: cu.user_id });
  return reply({ ok: true, tokenHash });
});
