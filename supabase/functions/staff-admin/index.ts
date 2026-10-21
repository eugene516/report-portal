// 직원 계정 관리 (관리자 이상)
// - create:   직원 계정 생성 (이메일 + 임시 비밀번호 + 이름 + 역할 staff/admin)
// - password: 직원 비밀번호 재설정 (오너 계정은 오너 본인만)
// - disable:  직원 비활성화 (로그인 차단 + 직원 명단에서 제거 → 담당 배정도 함께 해제)
// 사용자 계정 생성은 Supabase 관리자 권한이 필요하므로 웹 서버가 아니라 이 함수 안에서만 한다.
// 비밀번호는 관리자 화면(브라우저) → 이 함수로 직접 전송되며 로그에 남기지 않는다.
import { errorMessage, log } from "../_shared/log.ts";
import { corsHeaders, getCaller, json, serviceClient, withCors } from "../_shared/common.ts";

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/;
const UUID = /^[0-9a-f-]{36}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const reply = (body: unknown, status = 200) => withCors(req, json(body, status));
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller?.isAdmin) return reply({ error: "forbidden" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "invalid body" }, 400); }
  const db = serviceClient();
  const action = String(body.action ?? "");

  if (action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? "").trim().slice(0, 40) || null;
    const role = body.role === "admin" ? "admin" : "staff";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: "이메일 형식이 올바르지 않습니다." }, 400);
    if (!PASSWORD_RULE.test(password)) return reply({ error: "임시 비밀번호는 10자 이상, 영문 대·소문자와 숫자를 포함해야 합니다." }, 400);
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      log("warn", "staff create failed", { error: errorMessage(error, [password]) }, [password]);
      return reply({ error: /already|registered|exists/i.test(error?.message ?? "") ? "이미 등록된 이메일입니다." : "계정을 만들지 못했습니다." }, 400);
    }
    const { error: e2 } = await db.from("staff_roles").insert({ user_id: data.user.id, email, role, display_name: displayName });
    if (e2) {
      await db.auth.admin.deleteUser(data.user.id);
      return reply({ error: "직원 명단에 등록하지 못했습니다." }, 500);
    }
    log("info", "staff created", { by: caller.userId, role });
    return reply({ ok: true, userId: data.user.id });
  }

  const userId = String(body.userId ?? "");
  if (!UUID.test(userId)) return reply({ error: "invalid userId" }, 400);
  const { data: target } = await db.from("staff_roles").select("role").eq("user_id", userId).maybeSingle();
  if (!target) return reply({ error: "직원을 찾을 수 없습니다." }, 404);

  if (action === "password") {
    const password = String(body.password ?? "");
    if (!PASSWORD_RULE.test(password)) return reply({ error: "비밀번호는 10자 이상, 영문 대·소문자와 숫자를 포함해야 합니다." }, 400);
    if (target.role === "owner" && userId !== caller.userId) return reply({ error: "오너 계정의 비밀번호는 오너 본인만 바꿀 수 있습니다." }, 403);
    const { error } = await db.auth.admin.updateUserById(userId, { password });
    if (error) return reply({ error: "비밀번호를 바꾸지 못했습니다." }, 500);
    log("info", "staff password reset", { by: caller.userId, target: userId });
    return reply({ ok: true });
  }

  if (action === "disable") {
    if (target.role === "owner") return reply({ error: "오너 계정은 비활성화할 수 없습니다. 먼저 오너 권한을 양도하세요." }, 400);
    if (userId === caller.userId) return reply({ error: "본인 계정은 비활성화할 수 없습니다." }, 400);
    const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: "876000h" });   // 사실상 영구 로그인 차단
    if (error) return reply({ error: "비활성화하지 못했습니다." }, 500);
    await db.from("staff_roles").delete().eq("user_id", userId);   // 담당 배정(client_staff)도 함께 삭제
    log("info", "staff disabled", { by: caller.userId, target: userId });
    return reply({ ok: true });
  }

  return reply({ error: "unknown action" }, 400);
});
