// 네이버 검색광고 성과 수집
// 호출 경로
//   1) 예약 실행: pg_cron 이 매일 UTC 00:00 (= 한국시간 09:00) 에 x-cron-secret 헤더와 함께 호출
//      → 활성 광고주 전체, 전일 + 최근 7일 (한국시간 기준 오늘-7 ~ 오늘-1) 재수집
//   2) 수동 재수집: 담당 직원·관리자 로그인 토큰 + { clientId, from, to } (최대 92일), 전체는 관리자만
// 동작
//   - 실행 잠금으로 동시 실행을 막는다 (sync_locks)
//   - 광고주별로 순차 실행, 한 광고주가 실패해도 나머지는 계속
//   - 같은 날짜·캠페인은 upsert 로 덮어쓴다
//   - 광고주별 결과(성공/실패, 건수, 소요시간)를 naver_sync_logs 에 기록, 실패 시 담당자 이메일 알림
//   - 키는 이 함수 안에서 광고주를 처리하는 동안만 복호화해 쓰고 버린다
import { decryptCredentials, type NaverCredentials } from "../_shared/crypto.ts";
import { errorMessage, log } from "../_shared/log.ts";
import { getBizmoney, getDailyStats, listAdgroups, listCampaigns, listKeywords, type NaverStat } from "../_shared/naver.ts";
import { corsHeaders, dateRange, getCaller, isCronRequest, json as jsonRaw, kstDate, notifyFailure, serviceClient, withCors } from "../_shared/common.ts";

const LOCK = "naver_sync";
const LOCK_TTL_SECONDS = 15 * 60;
const MAX_MANUAL_DAYS = 92;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const json = (body: unknown, status = 200) => withCors(req, jsonRaw(body, status));
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let trigger: "schedule" | "manual";
  let requestedBy: string | null = null;
  let onlyClient: string | null = null;
  let from = kstDate(-7), to = kstDate(-1);

  if (isCronRequest(req)) {
    trigger = "schedule";
    // 내부 호출(예약 비밀값 보유)에 한해 과거 기간 채우기 허용: { from, to } (최대 92일)
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* 예약 실행은 빈 본문 */ }
    if (body.from || body.to) {
      from = String(body.from ?? ""); to = String(body.to ?? "");
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to && to <= kstDate(0);
      if (!ok || dateRange(from, to).length > MAX_MANUAL_DAYS) return json({ error: `invalid range (최대 ${MAX_MANUAL_DAYS}일)` }, 400);
    }
  } else {
    const caller = await getCaller(req);
    if (!caller) return json({ error: "forbidden" }, 403);
    trigger = "manual";
    requestedBy = caller.userId;
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* 빈 본문 허용 */ }
    if (body.clientId) {
      if (!/^[0-9a-f-]{36}$/.test(String(body.clientId))) return json({ error: "invalid clientId" }, 400);
      onlyClient = String(body.clientId);
      if (!(await caller.canAccess(onlyClient))) return json({ error: "forbidden" }, 403);   // 담당 광고주만
    } else if (!caller.isAdmin) {
      return json({ error: "forbidden" }, 403);   // 전체 재수집은 관리자 이상만
    }
    if (body.from || body.to) {
      from = String(body.from ?? ""); to = String(body.to ?? "");
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to && to <= kstDate(0);
      if (!ok || dateRange(from, to).length > MAX_MANUAL_DAYS) return json({ error: `invalid range (최대 ${MAX_MANUAL_DAYS}일)` }, 400);
    }
  }

  const db = serviceClient();
  const runId = crypto.randomUUID();
  const { data: locked, error: lockError } = await db.rpc("acquire_sync_lock", { p_name: LOCK, p_holder: runId, p_ttl_seconds: LOCK_TTL_SECONDS });
  if (lockError) {
    log("error", "sync lock error", { runId, error: lockError.message });
    await notifyFailure("[리포트 포털] 네이버 광고 수집 시작 실패", ["실행 잠금을 얻지 못했습니다. 관리자 확인이 필요합니다."]);
    return json({ error: "lock error" }, 500);
  }
  if (!locked) {
    await db.from("naver_sync_logs").insert({ run_id: runId, trigger_type: trigger, requested_by: requestedBy, date_from: from, date_to: to, status: "skipped", error_message: "이미 다른 수집이 실행 중입니다.", finished_at: new Date().toISOString() });
    return json({ error: "already running" }, 409);
  }

  const results: { clientId: string; status: string; rows: number; error?: string; bizmoney?: string }[] = [];
  try {
    let q = db.from("naver_ad_accounts").select("client_id, enc_payload, clients(name)").eq("is_active", true);
    if (onlyClient) q = q.eq("client_id", onlyClient);
    const { data: accounts, error } = await q;
    if (error) throw new Error("account query failed");

    for (const acc of accounts ?? []) {
      const started = Date.now();
      const { data: logRow } = await db.from("naver_sync_logs").insert({
        run_id: runId, client_id: acc.client_id, trigger_type: trigger, requested_by: requestedBy, date_from: from, date_to: to, status: "running",
      }).select("id").single();

      let creds: NaverCredentials | null = null;
      try {
        creds = await decryptCredentials(acc.enc_payload);
        const { rows, bizmoney } = await syncClient(db, acc.client_id, creds, from, to);
        await db.from("naver_sync_logs").update({ status: "success", rows_upserted: rows, duration_ms: Date.now() - started, finished_at: new Date().toISOString(),
          error_message: bizmoney === "ok" ? null : `(성과 수집 성공) 비즈머니: ${bizmoney}` }).eq("id", logRow!.id);
        results.push({ clientId: acc.client_id, status: "success", rows, bizmoney });
      } catch (e) {
        const msg = errorMessage(e, creds ? [creds.customerId, creds.accessLicense, creds.secretKey] : []);
        await db.from("naver_sync_logs").update({ status: "failed", error_message: msg, duration_ms: Date.now() - started, finished_at: new Date().toISOString() }).eq("id", logRow!.id);
        results.push({ clientId: acc.client_id, status: "failed", rows: 0, error: `${(acc as { clients?: { name?: string } }).clients?.name ?? acc.client_id}: ${msg}` });
        log("error", "naver sync failed for client", { clientId: acc.client_id, error: msg });
      } finally {
        creds = null; // 복호화한 키를 더 들고 있지 않는다
      }
    }
  } finally {
    await db.rpc("release_sync_lock", { p_name: LOCK, p_holder: runId });
  }

  const failed = results.filter((r) => r.status === "failed");
  if (failed.length) {
    await notifyFailure(`[리포트 포털] 네이버 광고 수집 실패 ${failed.length}건`, [
      `실행: ${trigger === "schedule" ? "예약(매일 09:00)" : "관리자 수동"} / 기간 ${from} ~ ${to}`,
      ...failed.map((f) => `- ${f.error}`),
      "자세한 내용은 리포트 포털 내부 대시보드의 '확인 필요'에서 확인하세요.",
    ]);
  }
  log("info", "naver sync finished", { runId, trigger, from, to, total: results.length, failed: failed.length });
  return json({ runId, from, to, results: results.map(({ error: _e, ...r }) => r) });
});

// 광고주 한 곳: 캠페인·광고그룹·키워드 정보 갱신 → 날짜별 캠페인 성과 + 광고그룹·키워드 성과 upsert → 비즈머니 잔액
async function syncClient(db: ReturnType<typeof serviceClient>, clientId: string, creds: NaverCredentials, from: string, to: string): Promise<{ rows: number; bizmoney: string }> {
  const now = new Date().toISOString();
  const entity = (r: Record<string, unknown>) => ({ client_id: clientId, updated_at: now, campaign_type: null, status: null, bid_amt: null, parent_ncc_id: null, ...r });
  const campaigns = await listCampaigns(creds);
  if (campaigns.length) {
    await db.from("naver_campaigns").upsert(campaigns.map((c) => entity({
      entity_type: "campaign", ncc_id: c.nccCampaignId, name: c.name, campaign_type: c.campaignTp ?? null, status: c.status ?? null,
    })), { onConflict: "client_id,ncc_id" });
  }
  const adgroupIds: string[] = [];
  const keywordIds: string[] = [];
  for (const c of campaigns) {
    const groups = await listAdgroups(creds, c.nccCampaignId);
    if (!groups.length) continue;
    await db.from("naver_campaigns").upsert(groups.map((g) => entity({
      entity_type: "adgroup", ncc_id: g.nccAdgroupId, parent_ncc_id: g.nccCampaignId, name: g.name, campaign_type: g.adgroupType ?? null, status: g.status ?? null,
    })), { onConflict: "client_id,ncc_id" });
    for (const g of groups) {
      adgroupIds.push(g.nccAdgroupId);
      const kws = await listKeywords(creds, g.nccAdgroupId);
      if (!kws.length) continue;
      keywordIds.push(...kws.map((k) => k.nccKeywordId));
      await db.from("naver_campaigns").upsert(kws.map((k) => entity({
        entity_type: "keyword", ncc_id: k.nccKeywordId, parent_ncc_id: k.nccAdgroupId, name: k.keyword, status: k.status ?? null,
        bid_amt: k.useGroupBidAmt ? null : (k.bidAmt ?? null),
      })), { onConflict: "client_id,ncc_id" });
    }
  }

  const metrics = (s: NaverStat) => {
    const cost = s.salesAmt ?? 0;          // salesAmt = 비용(VAT 포함), 공식 문서 기준
    return {
      impressions: s.impCnt ?? 0, clicks: s.clkCnt ?? 0, ctr: s.ctr ?? null, cpc: s.cpc ?? null, cost,
      avg_rank: s.avgRnk ?? null, conversions: s.ccnt ?? 0, conversion_revenue: s.convAmt ?? 0,
      collected_at: new Date().toISOString(),
    };
  };
  const ids = campaigns.map((c) => c.nccCampaignId);
  let total = 0;
  for (const date of dateRange(from, to)) {
    const stats = await getDailyStats(creds, ids, date);
    if (stats.length) {
      const rows = stats.map((s) => {
        const m = metrics(s);
        return { client_id: clientId, stat_date: date, ncc_campaign_id: s.id, ...m,
                 roas: s.ror ?? (m.cost > 0 ? Math.round((m.conversion_revenue / m.cost) * 10000) / 100 : null) };
      });
      const { error } = await db.from("naver_daily_stats").upsert(rows, { onConflict: "client_id,stat_date,ncc_campaign_id" });
      if (error) throw new Error("stats upsert failed");
      total += rows.length;
    }
    // 광고그룹 · 키워드 (수준별로 따로 요청)
    for (const [level, list] of [["adgroup", adgroupIds], ["keyword", keywordIds]] as const) {
      if (!list.length) continue;
      const es = await getDailyStats(creds, list, date);
      const rows = es.filter((s) => (s.impCnt ?? 0) > 0 || (s.salesAmt ?? 0) > 0 || (s.clkCnt ?? 0) > 0)
        .map((s) => ({ client_id: clientId, stat_date: date, level, ncc_id: s.id, ...metrics(s) }));
      if (rows.length) {
        const { error } = await db.from("naver_entity_daily_stats").upsert(rows, { onConflict: "client_id,stat_date,ncc_id" });
        if (error) throw new Error(`${level} stats upsert failed`);
      }
    }
  }

  // 비즈머니 잔액 (실패해도 성과 수집은 성공으로 본다). 결과는 응답·상태 테이블에 남긴다.
  let biz = "ok";
  try {
    const b = await getBizmoney(creds);
    const { error } = await db.from("naver_account_status").upsert({ client_id: clientId, bizmoney: b.bizmoney ?? null, budget_lock: b.budgetLock ?? null, checked_at: new Date().toISOString(), error_message: null });
    if (error) biz = `save failed: ${error.code ?? ""} ${error.message.slice(0, 120)}`;
    else if (b.bizmoney == null) biz = "no bizmoney field";
  } catch (e) {
    biz = errorMessage(e, [creds.customerId, creds.accessLicense, creds.secretKey]);
    log("warn", "bizmoney fetch failed", { clientId, error: biz });
    const { error } = await db.from("naver_account_status").upsert({ client_id: clientId, bizmoney: null, budget_lock: null, checked_at: new Date().toISOString(), error_message: biz });
    if (error) biz += ` / save failed: ${error.code ?? ""} ${error.message.slice(0, 120)}`;
  }
  return { rows: total, bizmoney: biz };
}
