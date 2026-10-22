// 직원 계정 관리 (관리자 이상)
// - invite:   직원 초대 (계정 생성 + 임시 비밀번호 자동 발급, 관리자가 복사해 전달 · 메일 설정 시 메일도 발송)
// - reinvite: 초대 재발송 (새 임시 비밀번호 발급 + 메일)
// - create:   직원 계정 생성 (관리자가 정한 임시 비밀번호, 이전 방식)
// - password: 직원 비밀번호 재설정 (오너 계정은 오너 본인만)
// - disable:  직원 비활성화 (로그인 차단 + 직원 명단에서 제거 → 담당 배정도 함께 해제)
// 사용자 계정 생성은 Supabase 관리자 권한이 필요하므로 웹 서버가 아니라 이 함수 안에서만 한다.
// 비밀번호는 로그에 남기지 않고 DB에도 저장하지 않는다 (Supabase Auth 의 해시만 남음).
import { errorMessage, log } from "../_shared/log.ts";
import { corsHeaders, getCaller, json, sendMail, serviceClient, siteUrl, withCors } from "../_shared/common.ts";

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/;
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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// 초대 메일: 로그인 주소 + 아이디(이메일) + 임시 비밀번호
async function mailInvite(email: string, name: string | null, password: string, inviter: string): Promise<{ mailed: boolean; loginUrl: string }> {
  const loginUrl = `${siteUrl()}/login?email=${encodeURIComponent(email)}`;
  const hello = name ? `${name}님, ` : "";
  const text = [
    `${hello}믿는구석 리포트 포털에 초대되었습니다. (초대한 사람: ${inviter})`,
    "",
    `로그인 주소: ${loginUrl}`,
    `아이디: ${email}`,
    `임시 비밀번호: ${password}`,
    "",
    "첫 로그인 후 '내 정보 수정' 화면에서 비밀번호를 꼭 바꿔 주세요.",
    "이 메일은 다른 사람에게 전달하지 마세요.",
  ].join("\n");
  const html = `<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#111">
<p>${esc(hello)}<b>믿는구석 리포트 포털</b>에 초대되었습니다.<br><span style="color:#666">초대한 사람: ${esc(inviter)}</span></p>
<table style="border-collapse:collapse;margin:16px 0">
<tr><td style="padding:6px 16px 6px 0;color:#666">아이디</td><td style="padding:6px 0"><b>${esc(email)}</b></td></tr>
<tr><td style="padding:6px 16px 6px 0;color:#666">임시 비밀번호</td><td style="padding:6px 0;font-family:monospace;font-size:17px"><b>${esc(password)}</b></td></tr>
</table>
<p><a href="${esc(loginUrl)}" style="display:inline-block;background:#2b59c3;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">리포트 포털 로그인</a></p>
<p style="color:#666;font-size:13px">첫 로그인 후 '내 정보 수정' 화면에서 비밀번호를 꼭 바꿔 주세요. 이 메일은 다른 사람에게 전달하지 마세요.</p>
</div>`;
  const mailed = await sendMail(email, "[믿는구석] 리포트 포털 초대", text, html);
  return { mailed, loginUrl };
}

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

  const { data: me } = await db.from("staff_roles").select("email, display_name").eq("user_id", caller.userId).maybeSingle();
  const inviter = me?.display_name ?? me?.email ?? "관리자";

  // 초대: 계정 생성(이메일 인증 완료 상태) + 임시 비밀번호 발급
  // 임시 비밀번호는 이 응답으로 한 번만 돌려주고, 관리자가 초대 링크와 함께 복사해 직접 전달한다.
  // (메일 발송 설정(RESEND_API_KEY·MAIL_FROM)이 있으면 초대 메일도 함께 보낸다)
  if (action === "invite") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const displayName = String(body.displayName ?? "").trim().slice(0, 40) || null;
    const role = body.role === "admin" ? "admin" : "staff";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: "이메일 형식이 올바르지 않습니다." }, 400);
    const password = tempPassword();
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      log("warn", "staff invite failed", { error: errorMessage(error, [password]) }, [password]);
      return reply({ error: /already|registered|exists/i.test(error?.message ?? "") ? "이미 등록된 이메일입니다. 아래 목록에서 '임시 비밀번호 재발급'을 이용하세요." : "계정을 만들지 못했습니다." }, 400);
    }
    const now = new Date().toISOString();
    const { error: e2 } = await db.from("staff_roles").insert({ user_id: data.user.id, email, role, display_name: displayName, must_change_password: true, invited_at: now, invited_by: caller.userId });
    if (e2) {
      await db.auth.admin.deleteUser(data.user.id);
      return reply({ error: "직원 명단에 등록하지 못했습니다." }, 500);
    }
    const { mailed, loginUrl } = await mailInvite(email, displayName, password, inviter);
    if (mailed) await db.from("staff_roles").update({ invite_mailed_at: now }).eq("user_id", data.user.id);
    log("info", "staff invited", { by: caller.userId, role, mailed });
    return reply({ ok: true, userId: data.user.id, mailed, loginUrl, tempPassword: password });
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
    if (!error && userId !== caller.userId) await db.from("staff_roles").update({ must_change_password: true }).eq("user_id", userId);
    if (error) return reply({ error: "비밀번호를 바꾸지 못했습니다." }, 500);
    log("info", "staff password reset", { by: caller.userId, target: userId });
    return reply({ ok: true });
  }

  // 초대 재발송: 새 임시 비밀번호로 바꾸고 다시 메일 (이전 임시 비밀번호는 무효)
  if (action === "reinvite") {
    if (target.role === "owner") return reply({ error: "오너 계정에는 초대를 다시 보낼 수 없습니다." }, 400);
    if (userId === caller.userId) return reply({ error: "본인 계정은 '내 정보 수정'에서 비밀번호를 바꾸세요." }, 400);
    const password = tempPassword();
    const { data: u, error } = await db.auth.admin.updateUserById(userId, { password });
    if (error || !u.user?.email) return reply({ error: "임시 비밀번호를 다시 만들지 못했습니다." }, 500);
    const now = new Date().toISOString();
    await db.from("staff_roles").update({ must_change_password: true, invited_at: now, invited_by: caller.userId }).eq("user_id", userId);
    const { data: t } = await db.from("staff_roles").select("display_name").eq("user_id", userId).maybeSingle();
    const { mailed, loginUrl } = await mailInvite(u.user.email, t?.display_name ?? null, password, inviter);
    if (mailed) await db.from("staff_roles").update({ invite_mailed_at: now }).eq("user_id", userId);
    log("info", "staff reinvited", { by: caller.userId, target: userId, mailed });
    return reply({ ok: true, mailed, loginUrl, tempPassword: password });
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
