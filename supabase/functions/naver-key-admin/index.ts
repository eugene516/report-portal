// 관리자 전용: 광고주 네이버 검색광고 API 키 등록·교체·비활성화·삭제
// - 관리자 화면(브라우저)에서 로그인 토큰과 함께 이 함수로 직접 보낸다. 웹 서버(Vercel)를 거치지 않는다.
// - 키는 네이버 API로 연결을 확인한 뒤 AES-256-GCM 으로 암호화해 저장한다. 응답에는 끝 4자리만 돌려준다.
// - 원문 조회 기능은 없다. 교체는 새 값으로 덮어쓰기만 가능하다.
// - 등록·수정·삭제는 감사 로그(naver_key_audit_logs)에 누가·언제만 남긴다.
import { encryptCredentials, last4, type NaverCredentials } from "../_shared/crypto.ts";
import { errorMessage, log } from "../_shared/log.ts";
import { listCampaigns, NaverApiError } from "../_shared/naver.ts";
import { getCaller, json, serviceClient } from "../_shared/common.ts";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_ORIGIN") ?? "",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const reply = (body: unknown, status = 200) => {
    const r = json(body, status);
    for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
    return r;
  };
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller?.isAdmin) return reply({ error: "forbidden" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "invalid body" }, 400); }
  const action = String(body.action ?? "");
  const clientId = String(body.clientId ?? "");
  if (!/^[0-9a-f-]{36}$/.test(clientId)) return reply({ error: "invalid clientId" }, 400);

  const db = serviceClient();
  const { data: client } = await db.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return reply({ error: "client not found" }, 404);

  const audit = (a: string) =>
    db.from("naver_key_audit_logs").insert({ client_id: clientId, action: a, actor_id: caller.userId, actor_email: caller.email });

  if (action === "upsert") {
    const creds: NaverCredentials = {
      customerId: String(body.customerId ?? "").trim(),
      accessLicense: String(body.accessLicense ?? "").trim(),
      secretKey: String(body.secretKey ?? "").trim(),
    };
    if (!/^\d{3,20}$/.test(creds.customerId) || creds.accessLicense.length < 10 || creds.secretKey.length < 10) {
      return reply({ error: "세 가지 값(CUSTOMER_ID, 액세스라이선스, 비밀키)을 모두 정확히 입력해 주세요." }, 400);
    }
    const secrets = [creds.customerId, creds.accessLicense, creds.secretKey];
    // 1) 연결 확인: 캠페인 목록 조회가 되는지
    let campaignCount = 0;
    try {
      campaignCount = (await listCampaigns(creds)).length;
    } catch (e) {
      const msg = e instanceof NaverApiError ? e.message : errorMessage(e, secrets);
      log("warn", "naver key verification failed", { clientId, error: msg }, secrets);
      return reply({ error: "네이버 API 연결 확인에 실패했습니다. 키 세 가지를 다시 확인해 주세요.", detail: msg }, 422);
    }
    // 2) 암호화 저장 (덮어쓰기)
    const { data: existing } = await db.from("naver_ad_accounts").select("id").eq("client_id", clientId).maybeSingle();
    const enc = await encryptCredentials(creds);
    const row = {
      client_id: clientId, enc_payload: enc, key_version: 1,
      customer_id_last4: last4(creds.customerId), access_license_last4: last4(creds.accessLicense), secret_key_last4: last4(creds.secretKey),
      is_active: true, updated_at: new Date().toISOString(), updated_by: caller.userId,
    };
    const { error } = await db.from("naver_ad_accounts").upsert(row, { onConflict: "client_id" });
    if (error) { log("error", "naver key save failed", { clientId, error: error.message }, secrets); return reply({ error: "저장에 실패했습니다." }, 500); }
    await db.from("client_ad_channels").upsert({ client_id: clientId, channel: "naver", api_connected: true, updated_at: new Date().toISOString() }, { onConflict: "client_id,channel" });
    await audit(existing ? "update" : "create");
    log("info", "naver key saved", { clientId, action: existing ? "update" : "create" });
    return reply({ ok: true, campaignCount, customerIdLast4: row.customer_id_last4, accessLicenseLast4: row.access_license_last4, secretKeyLast4: row.secret_key_last4 });
  }

  if (action === "deactivate" || action === "delete") {
    const q = action === "delete"
      ? db.from("naver_ad_accounts").delete().eq("client_id", clientId)
      : db.from("naver_ad_accounts").update({ is_active: false, updated_at: new Date().toISOString(), updated_by: caller.userId }).eq("client_id", clientId);
    const { error } = await q;
    if (error) return reply({ error: "처리에 실패했습니다." }, 500);
    await db.from("client_ad_channels").update({ api_connected: false, updated_at: new Date().toISOString() }).eq("client_id", clientId).eq("channel", "naver");
    await audit(action);
    return reply({ ok: true });
  }

  return reply({ error: "unknown action" }, 400);
});
