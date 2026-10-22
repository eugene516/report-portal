// 광고주 계정 관리 (그 광고주의 담당 직원 · 관리자) — 파일 검수용 로그인 계정
// - create: 광고주 계정 생성 + 임시 비밀번호 발급 (응답으로 한 번만 돌려줌, 직원이 복사해 전달)
// - reset:  임시 비밀번호 재발급
// - remove: 계정 삭제 (검수 기록의 이름은 남는다)
// 광고주 계정은 직원 명단(staff_roles)에 넣지 않는다 → 직원 화면 · 데이터 권한(can_access_client)이 없다.
// 비밀번호는 로그에 남기지 않고 DB에도 저장하지 않는다 (Supabase Auth 의 해시만 남음).
import { errorMessage, log } from "../_shared/log.ts";
import { corsHeaders, getCaller, json, serviceClient, withCors } from "../_shared/common.ts";

const UUID = /^[0-9a-f-]{36}$/;

// 임시 비밀번호: 헷갈리는 글자(0/O, 1/l/I) 제외, 대문자·소문자·숫자 각 1자 이상, 12자
function tempPassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789"];
  const all = sets.join("");
  const rnd = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const chars = [...sets.map((s) => s[rnd(s.length)]), ...Array.from({ length: 9 }, () => all[rnd(all.length)])];
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

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
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: "이메일 형식이 올바르지 않습니다." }, 400);
    const { data: staff } = await db.from("staff_roles").select("user_id").eq("email", email).maybeSingle();
    if (staff) return reply({ error: "직원 계정 이메일은 광고주 계정으로 쓸 수 없습니다." }, 400);
    const password = tempPassword();
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      log("warn", "client account create failed", { error: errorMessage(error, [password]) }, [password]);
      return reply({ error: /already|registered|exists/i.test(error?.message ?? "") ? "이미 등록된 이메일입니다. 목록에서 '임시 비밀번호 재발급'을 이용하세요." : "계정을 만들지 못했습니다." }, 400);
    }
    const { error: e2 } = await db.from("client_users").insert({ user_id: data.user.id, client_id: clientId, email, name, created_by: caller.userId });
    if (e2) { await db.auth.admin.deleteUser(data.user.id); return reply({ error: "광고주 계정을 등록하지 못했습니다." }, 500); }
    log("info", "client account created", { by: caller.userId, client: clientId });
    return reply({ ok: true, userId: data.user.id, email, tempPassword: password });
  }

  // reset · remove: 그 계정의 광고주 담당 직원 · 관리자만
  const userId = String(body.userId ?? "");
  if (!UUID.test(userId)) return reply({ error: "invalid userId" }, 400);
  const { data: cu } = await db.from("client_users").select("client_id, email").eq("user_id", userId).maybeSingle();
  if (!cu || !(await caller.canAccess(cu.client_id))) return reply({ error: "forbidden" }, 403);

  if (action === "reset") {
    const password = tempPassword();
    const { error } = await db.auth.admin.updateUserById(userId, { password });
    if (error) { log("warn", "client password reset failed", { error: errorMessage(error, [password]) }, [password]); return reply({ error: "비밀번호를 재발급하지 못했습니다." }, 500); }
    await db.from("client_users").update({ must_change_password: true }).eq("user_id", userId);
    log("info", "client password reset", { by: caller.userId, target: userId });
    return reply({ ok: true, email: cu.email, tempPassword: password });
  }
  if (action === "remove") {
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) return reply({ error: "계정을 삭제하지 못했습니다." }, 500);
    log("info", "client account removed", { by: caller.userId, target: userId });
    return reply({ ok: true });
  }
  return reply({ error: "unknown action" }, 400);
});
