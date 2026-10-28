// 광고주 로그인 이메일 관리 (그 광고주의 담당 직원 · 오너 · 관리자)
// - create: 광고주 이메일 등록. 광고주는 광고주 링크 화면에서 이 이메일만 입력해 로그인한다 (client-login)
// - remove: 등록 삭제 (검수 기록의 이름은 남는다)
// 광고주 계정은 직원 명단(staff_roles)에 넣지 않는다 → 직원 화면 · 데이터 권한(can_access_client)이 없다.
// 비밀번호는 쓰지 않는다: 계정 생성 시 아무도 모르는 무작위 비밀번호를 넣고 돌려주지 않는다.
import { errorMessage, log } from "../_shared/log.ts";
import { corsHeaders, getCaller, json, serviceClient, withCors } from "../_shared/common.ts";

const UUID = /^[0-9a-f-]{36}$/;

// 쓰지 않는 비밀번호 (Auth 계정에 필요해서만 넣는다): 32바이트 무작위
const unusedPassword = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const reply = (body: unknown, status = 200) => withCors(req, json(body, status));
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller) return reply({ error: "forbidden" }, 403);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "invalid body" }, 400); }
  const db = serviceClient();
  const action = String(body.action ?? "");

  if (action === "create") {
    const clientId = String(body.clientId ?? "");
    if (!UUID.test(clientId) || !(await caller.canAccess(clientId))) return reply({ error: "forbidden" }, 403);
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim().slice(0, 40) || null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return reply({ error: "이메일 형식이 올바르지 않습니다." }, 400);
    const { data: staff } = await db.from("staff_roles").select("user_id").eq("email", email).maybeSingle();
    if (staff) return reply({ error: "직원 계정 이메일은 광고주 이메일로 쓸 수 없습니다." }, 400);
    const password = unusedPassword();
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      log("warn", "client account create failed", { error: errorMessage(error, [password]) }, [password]);
      return reply({ error: /already|registered|exists/i.test(error?.message ?? "") ? "이미 등록된 이메일입니다. 한 이메일은 한 광고주에만 등록할 수 있습니다." : "이메일을 등록하지 못했습니다." }, 400);
    }
    const { error: e2 } = await db.from("client_users").insert({ user_id: data.user.id, client_id: clientId, email, name, created_by: caller.userId, must_change_password: false });
    if (e2) { await db.auth.admin.deleteUser(data.user.id); return reply({ error: "광고주 이메일을 등록하지 못했습니다." }, 500); }
    log("info", "client account created", { by: caller.userId, client: clientId });
    return reply({ ok: true, userId: data.user.id, email });
  }

  // remove: 그 계정의 광고주 담당 직원 · 오너 · 관리자만
  const userId = String(body.userId ?? "");
  if (!UUID.test(userId)) return reply({ error: "invalid userId" }, 400);
  const { data: cu } = await db.from("client_users").select("client_id, email").eq("user_id", userId).maybeSingle();
  if (!cu || !(await caller.canAccess(cu.client_id))) return reply({ error: "forbidden" }, 403);

  if (action === "remove") {
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) return reply({ error: "삭제하지 못했습니다." }, 500);
    log("info", "client account removed", { by: caller.userId, target: userId });
    return reply({ ok: true });
  }
  return reply({ error: "unknown action" }, 400);
});
