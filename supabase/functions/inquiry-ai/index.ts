// 문의관리 AI 도우미 (직원 누구나 · 로그인 토큰 필수)
// - parse     : 문의 원문 → 회사 · 담당자 · 연락처 · 채널 · 관심 서비스 등 항목 (새 문의 창)
// - next      : 카드 + 상담 이력 → 다음 액션 추천 {text, date, why}
// - draft     : 후속 메일 / 카톡 초안 (자동 발송하지 않는다. 화면에서 복사 후 '보낸 것으로 기록')
// - summarize : 미팅 녹취 → 핵심 · 결정한 것 · 우리가 할 일 · 상대가 할 일
// - monthly   : 한 달(또는 최근 3개월) 집계 숫자 → 월간 요약. inquiry_monthly_summaries 에 저장
// 카드 자료는 화면이 보낸 값을 믿지 않고, 권한 확인 후 서비스 롤로 DB에서 다시 읽는다.
// Claude API 키는 함수 비밀값 ANTHROPIC_API_KEY 에만 둔다. 로그에는 고객 원문 · 키를 남기지 않는다.
import Anthropic from "npm:@anthropic-ai/sdk";
import { errorMessage, log } from "../_shared/log.ts";
import { corsHeaders, getCaller, json, kstDate, serviceClient, withCors } from "../_shared/common.ts";

// 기본 모델: Claude Opus 5.5. 비용을 더 줄이려면 함수 비밀값 INQUIRY_AI_MODEL 로 바꿀 수 있다 (예: claude-sonnet-5-5)
const MODEL = Deno.env.get("INQUIRY_AI_MODEL") || "claude-opus-5-5";
// 안전 분류기가 거절하면 서버가 다른 모델로 다시 시도한다 (지원 모델에서만 켠다)
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

const UUID = /^[0-9a-f-]{36}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const STAGE_NAME: Record<string, string> = {
  inquiry: "문의", responding: "요청 대응중", meeting: "미팅", proposal: "제안·견적",
  waiting: "대기", hold: "보류", won: "계약", lost: "미계약",
};
const KIND_NAME: Record<string, string> = { memo: "메모", call: "전화", mail: "메일", kakao: "카톡", meeting: "미팅", ai: "AI", stage: "단계" };
const COMPANY = "믿는구석 (believe-corner.com) — 병원·소상공인 마케팅 대행, 영상 제작, 홈페이지 제작, 사업화 컨설팅, 마케팅 강의를 하는 회사";

class UserError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type Settings = { channels: string[]; services: string[]; lost_reasons: string[]; sla: Record<string, number> };
type Inquiry = {
  id: string; no: number; company: string; person: string | null; phone: string | null; email: string | null; channel: string | null;
  referrer: string | null; services: string[]; budget: string | null; industry: string | null; region: string | null; summary: string | null;
  stage: string; owner: string | null; received_on: string; stage_changed_on: string; last_activity_on: string;
  next_action_text: string | null; next_action_on: string | null; contract_on: string | null; contract_type: string | null; contract_service: string | null;
  lost_reason: string | null; lost_memo: string | null; wait_until: string | null; wait_memo: string | null; hold_until: string | null; hold_memo: string | null;
};
const CARD_COLS = "id, no, company, person, phone, email, channel, referrer, services, budget, industry, region, summary, stage, owner, received_on, stage_changed_on, last_activity_on, next_action_text, next_action_on, contract_on, contract_type, contract_service, lost_reason, lost_memo, wait_until, wait_memo, hold_until, hold_memo";

const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

// ── Claude 호출: JSON 스키마로 구조화된 답을 받는다 ─────────────────────────────
async function askClaude<T>(client: Anthropic, opts: {
  system: string; user: string; schema: Record<string, unknown>; effort: "low" | "medium" | "high"; maxTokens?: number;
}): Promise<T> {
  const params: Record<string, unknown> = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: opts.schema } },
  };
  if (FALLBACK_MODELS.has(MODEL)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  // fallbacks · output_config 는 SDK 버전에 따라 타입 정의에 없을 수 있어 넓게 넘긴다
  // deno-lint-ignore no-explicit-any
  const res = await client.beta.messages.create(params as any) as unknown as ClaudeReply;
  if (res.stop_reason === "refusal") throw new UserError("AI가 이 요청을 처리하지 않았습니다. 내용을 바꿔 다시 시도해 주세요.", 422);
  if (res.stop_reason === "max_tokens") throw new UserError("AI 답이 너무 길어 중간에 끊겼습니다. 입력을 줄여 다시 시도해 주세요.", 422);
  const text = res.content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");
  log("info", "inquiry-ai claude call", { model: res.model, input: res.usage.input_tokens, output: res.usage.output_tokens });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UserError("AI 답을 읽지 못했습니다. 다시 시도해 주세요.", 502);
  }
}

type ClaudeReply = { stop_reason: string | null; model: string; usage: { input_tokens: number; output_tokens: number }; content: { type: string; text?: string }[] };
const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

function cardText(c: Inquiry, ownerName: string, events: { kind: string; body: string; created_at: string; author_name: string }[], today: string) {
  const lines = [
    `오늘: ${today}`,
    `회사: ${c.company} / 상대 담당자: ${c.person ?? "-"} / 업종: ${c.industry ?? "-"} / 지역: ${c.region ?? "-"}`,
    `채널: ${c.channel ?? "-"}${c.referrer ? ` (소개자 ${c.referrer})` : ""} / 관심 서비스: ${c.services.join(", ") || "-"} / 예산: ${c.budget ?? "미정"}`,
    `우리 담당: ${ownerName}`,
    `단계: ${STAGE_NAME[c.stage] ?? c.stage} (${c.stage_changed_on}부터) / 접수일: ${c.received_on} (${days(today, c.received_on)}일 전) / 마지막 기록: ${c.last_activity_on} (${days(today, c.last_activity_on)}일 전)`,
    `현재 다음 액션: ${c.next_action_text ? `${c.next_action_text} (${c.next_action_on ?? "날짜 없음"})` : "없음"}`,
  ];
  if (c.stage === "waiting") lines.push(`대기: 확인 예정일 ${c.wait_until ?? "-"} / 기다리는 것: ${c.wait_memo ?? "-"}`);
  if (c.stage === "hold") lines.push(`보류: 재접촉 예정일 ${c.hold_until ?? "-"} / 사유: ${c.hold_memo ?? "-"}`);
  if (c.stage === "won") lines.push(`계약: ${c.contract_on ?? "-"} · ${c.contract_type ?? "-"} · ${c.contract_service ?? "-"}`);
  if (c.stage === "lost") lines.push(`미계약 사유: ${c.lost_reason ?? "-"} / ${c.lost_memo ?? ""}`);
  lines.push(`요청 내용 요약: ${c.summary ?? "-"}`);
  lines.push("", "상담 이력 (오래된 순):");
  if (!events.length) lines.push("- 없음");
  for (const e of events) lines.push(`- ${e.created_at.slice(0, 10)} [${KIND_NAME[e.kind] ?? e.kind}] ${e.author_name}: ${e.body.slice(0, 1500)}`);
  return lines.join("\n");
}

// 월간 집계 (화면의 통계와 같은 기준: 접수일이 기간 안인 문의)
function periodRange(period: string, today: string): { from: string; to: string; label: string } {
  if (period === "recent3") {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 2);
    return { from: d.toISOString().slice(0, 10), to: today, label: "최근 3개월" };
  }
  const start = new Date(`${period}-01T00:00:00Z`);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  return { from: period + "-01", to: end.toISOString().slice(0, 10), label: `${Number(period.slice(0, 4))}년 ${Number(period.slice(5, 7))}월` };
}

function isStale(c: Inquiry, sla: Record<string, number>, today: string) {
  if (["won", "lost"].includes(c.stage)) return false;
  if (c.stage === "hold") return !!c.hold_until && c.hold_until <= today;
  if (c.stage === "waiting") return !!c.wait_until && c.wait_until <= today;
  if (c.next_action_on && c.next_action_on < today) return true;
  const s = sla[c.stage];
  return typeof s === "number" && days(today, c.last_activity_on) > s;
}

function monthlyStats(cards: Inquiry[], settings: Settings, today: string) {
  const reachedMeeting = ["meeting", "proposal", "waiting", "won", "lost"];
  const reachedProposal = ["proposal", "waiting", "won"];
  const by = (s: string) => cards.filter((c) => c.stage === s).length;
  const channels: Record<string, { 문의: number; 미팅도달: number; 제안: number; 계약: number; 미계약: number }> = {};
  for (const c of cards) {
    const k = c.channel || "미지정";
    const r = channels[k] ??= { 문의: 0, 미팅도달: 0, 제안: 0, 계약: 0, 미계약: 0 };
    r.문의++;
    if (reachedMeeting.includes(c.stage)) r.미팅도달++;
    if (reachedProposal.includes(c.stage)) r.제안++;
    if (c.stage === "won") r.계약++;
    if (c.stage === "lost") r.미계약++;
  }
  const services: Record<string, { 문의: number; 계약: number }> = {};
  for (const c of cards) for (const s of c.services) {
    const r = services[s] ??= { 문의: 0, 계약: 0 };
    r.문의++; if (c.stage === "won") r.계약++;
  }
  const lost: Record<string, number> = {};
  for (const c of cards.filter((x) => x.stage === "lost")) lost[c.lost_reason || "사유 없음"] = (lost[c.lost_reason || "사유 없음"] ?? 0) + 1;
  const industries: Record<string, number> = {};
  for (const c of cards) industries[c.industry || "미지정"] = (industries[c.industry || "미지정"] ?? 0) + 1;
  const won = cards.filter((c) => c.stage === "won" && c.contract_on);
  return {
    문의: cards.length, 계약: by("won"), 미계약: by("lost"), 보류: by("hold"), 대기: by("waiting"),
    진행중: cards.filter((c) => ["inquiry", "responding", "meeting", "proposal"].includes(c.stage)).length,
    기준일_넘긴_카드: cards.filter((c) => isStale(c, settings.sla, today)).length,
    평균_문의부터_계약_일수: won.length ? Math.round(won.reduce((a, c) => a + days(c.contract_on!, c.received_on), 0) / won.length) : null,
    채널별: channels, 서비스별: services, 미계약_사유: lost, 업종별: industries,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const reply = (body: unknown, status = 200) => withCors(req, json(body, status));
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  // 1) 직원 확인
  const caller = await getCaller(req);
  if (!caller) return reply({ error: "forbidden" }, 403);
  const db = serviceClient();
  const { data: me } = await db.from("staff_roles").select("user_id").eq("user_id", caller.userId).maybeSingle();
  if (!me) return reply({ error: "직원만 사용할 수 있습니다." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: "invalid body" }, 400); }
  const action = String(body.action ?? "");
  if (!["parse", "next", "draft", "summarize", "monthly"].includes(action)) return reply({ error: "unknown action" }, 400);

  // 2) AI 키 확인 (없으면 화면에 안내)
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return reply({ error: "AI 키가 설정되지 않았습니다. 관리자에게 ANTHROPIC_API_KEY 설정을 요청해 주세요." }, 503);
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  const today = kstDate();
  const started = Date.now();

  try {
    const { data: st } = await db.from("inquiry_settings").select("channels, services, lost_reasons, sla").eq("id", 1).maybeSingle();
    const settings: Settings = { channels: st?.channels ?? [], services: st?.services ?? [], lost_reasons: st?.lost_reasons ?? [], sla: st?.sla ?? {} };

    // ── parse ──────────────────────────────────────────────
    if (action === "parse") {
      const raw = String(body.raw ?? "").trim();
      if (!raw) throw new UserError("원문을 먼저 붙여넣으세요.");
      if (raw.length > 20000) throw new UserError("원문이 너무 깁니다 (2만 자 이하).");
      const schema = obj({
        company: str, person: str, phone: str, email: str,
        channel: settings.channels.length ? { type: "string", enum: [...settings.channels, ""] } : str,
        referrer: str,
        services: { type: "array", items: settings.services.length ? { type: "string", enum: settings.services } : str },
        budget: str, industry: str, region: str, summary: str,
      });
      const out = await askClaude<Record<string, unknown>>(client, {
        effort: "low", schema, maxTokens: 4000,
        system: [
          `당신은 ${COMPANY}의 영업 문의 접수 담당입니다. 붙여넣은 문의 원문(홈페이지 문의 메일, 카톡 대화, 명함 메모 등)에서 항목을 뽑아 JSON으로 답합니다.`,
          "원문에 없는 내용은 지어내지 말고 빈 문자열로 둡니다.",
          "company: 회사·병원·가게 이름. person: 상대 담당자 이름과 직책(예: '김민수 원장'). phone: 010-0000-0000 형식. budget: 원문 표현 그대로(예: '월 300만원').",
          "industry: 짧은 업종 분류(예: 병원·의원, 카페·요식, B2B 제조, 뷰티 브랜드). region: 시·도와 시·군·구(예: 경기 수원).",
          `channel: 문의 경로를 다음 중에서 고릅니다. 알 수 없으면 빈 문자열: ${settings.channels.join(", ") || "(목록 없음)"}`,
          "referrer: 지인·소개·BNI 경로일 때 소개한 사람이나 회사.",
          `services: 관심 서비스를 다음 목록에서 고릅니다(여러 개 가능): ${settings.services.join(", ") || "(목록 없음)"}. 병원·의원 마케팅이면 '마케팅 대행' 대신 '병원 마케팅'을 고릅니다.`,
          "summary: 우리 직원이 한눈에 볼 요청 내용 요약. 2~3문장, 한국어, 사실만.",
        ].join("\n"),
        user: `문의 원문:\n<원문>\n${raw}\n</원문>`,
      });
      log("info", "inquiry-ai done", { action, by: caller.userId, ms: Date.now() - started });
      return reply({ ok: true, fields: out });
    }

    // ── monthly ────────────────────────────────────────────
    if (action === "monthly") {
      const period = String(body.period ?? "");
      if (!PERIOD.test(period) && period !== "recent3") throw new UserError("기간이 올바르지 않습니다.");
      const range = periodRange(period, today);
      const { data: rows, error } = await db.from("inquiries").select(CARD_COLS).gte("received_on", range.from).lte("received_on", range.to);
      if (error) throw new Error(error.message);
      const stats = monthlyStats((rows ?? []) as Inquiry[], settings, today);
      const out = await askClaude<{ summary: string }>(client, {
        effort: "medium", schema: obj({ summary: str }), maxTokens: 6000,
        system: [
          `당신은 ${COMPANY}의 영업 관리 담당입니다. 기간 동안 들어온 문의의 집계 숫자를 보고 대표에게 보고할 월간 요약을 씁니다.`,
          "형식: 첫 줄에 제목('<기간> 문의 요약'), 빈 줄, 그다음 '- '로 시작하는 4~6개 항목. 한국어, 존댓말 서술체(~입니다).",
          "숫자는 주어진 집계만 쓰고 지어내지 않습니다. 건수가 적어 판단하기 어려우면 그렇다고 씁니다.",
          "전환이 잘 되는 채널, 미계약 사유 패턴, 기준일을 넘긴(방치된) 카드, 다음 달에 바꿔 볼 구체적인 실행 1~2가지를 포함합니다.",
        ].join("\n"),
        user: `기간: ${range.label} (${range.from} ~ ${range.to}, 접수일 기준)\n오늘: ${today}\n집계(JSON):\n${JSON.stringify(stats)}`,
      });
      const text = String(out.summary ?? "").slice(0, 8000);
      const { data: saved, error: e2 } = await db.from("inquiry_monthly_summaries")
        .insert({ period, body: text, stats, model: MODEL, created_by: caller.userId })
        .select("id, period, body, created_at").single();
      if (e2) throw new Error(e2.message);
      log("info", "inquiry-ai done", { action, by: caller.userId, period, ms: Date.now() - started });
      return reply({ ok: true, summary: saved });
    }

    // ── 카드 기준 동작: 카드 · 이력을 DB에서 다시 읽는다 ────────────
    const inquiryId = String(body.inquiryId ?? "");
    if (!UUID.test(inquiryId)) throw new UserError("문의를 찾을 수 없습니다.");
    const { data: card } = await db.from("inquiries").select(CARD_COLS).eq("id", inquiryId).maybeSingle();
    if (!card) throw new UserError("문의를 찾을 수 없습니다.", 404);
    const c = card as Inquiry;
    const { data: evRows } = await db.from("inquiry_events").select("kind, body, author, created_at")
      .eq("inquiry_id", inquiryId).order("created_at", { ascending: false }).limit(40);
    const authorIds = [...new Set([c.owner, ...(evRows ?? []).map((e) => e.author)].filter(Boolean))] as string[];
    const { data: people } = authorIds.length
      ? await db.from("staff_roles").select("user_id, display_name, email").in("user_id", authorIds)
      : { data: [] as { user_id: string; display_name: string | null; email: string }[] };
    const nameOf = (id: string | null) => {
      const p = (people ?? []).find((x) => x.user_id === id);
      return p ? (p.display_name ?? p.email.split("@")[0]) : "담당자";
    };
    const events = [...(evRows ?? [])].reverse().map((e) => ({ kind: e.kind, body: e.body, created_at: e.created_at, author_name: nameOf(e.author) }));
    const ownerName = c.owner ? nameOf(c.owner) : "미정";
    const context = cardText(c, ownerName, events, today);

    if (action === "next") {
      const out = await askClaude<{ text: string; date: string; why: string }>(client, {
        effort: "medium", maxTokens: 4000,
        schema: obj({ text: str, date: { type: "string", format: "date" }, why: str }),
        system: [
          `당신은 ${COMPANY}의 영업 코치입니다. 문의 카드와 상담 이력을 보고 우리 담당자가 할 '다음 액션' 하나를 추천합니다.`,
          "text: 바로 실행할 수 있는 구체적인 한 문장(누구에게 무엇을). 60자 안팎.",
          "date: 실행 날짜(YYYY-MM-DD). 보통 오늘이나 가까운 날. 대기·보류 카드는 확인일·재접촉일을 고려합니다.",
          "why: 왜 지금 이 액션인지 1~2문장. 경과 일수와 마지막 기록을 근거로 듭니다.",
          `단계별 기준일(이 일수 넘게 기록이 없으면 방치로 봄): ${JSON.stringify(settings.sla)}. 첫 응답은 24시간 안, 미팅 후 48시간 안에 요약 메일, 제안 후 3일째 확인·7일째 조건 조정·14일째 보류 전환을 기준으로 합니다.`,
          "계약·미계약 카드면 text 는 빈 문자열, date 는 오늘, why 에 종결된 카드라고 씁니다.",
        ].join("\n"),
        user: context,
      });
      log("info", "inquiry-ai done", { action, by: caller.userId, inquiry: inquiryId, ms: Date.now() - started });
      return reply({ ok: true, next: { text: String(out.text ?? "").slice(0, 300), date: /^\d{4}-\d{2}-\d{2}$/.test(out.date) ? out.date : today, why: String(out.why ?? "") } });
    }

    if (action === "draft") {
      const kind = body.kind === "kakao" ? "kakao" : "mail";
      const out = await askClaude<{ text: string }>(client, {
        effort: "low", maxTokens: 4000, schema: obj({ text: str }),
        system: [
          `당신은 ${COMPANY}의 담당자 '${ownerName}'을 대신해 고객에게 보낼 후속 연락 초안을 씁니다. 초안은 담당자가 확인 후 직접 보냅니다.`,
          kind === "mail"
            ? "메일: 첫 줄은 '제목: ...', 빈 줄, 본문. 정중한 존댓말. 인사 → 지난 상담 내용을 짚는 한두 문장 → 이번 연락의 목적과 다음 단계 제안 → 서명('<담당자 이름> 드림', '믿는구석 · believe-corner.com'). 10줄 안팎."
            : "카톡: 3~5줄의 짧고 친근한 존댓말. 첫 줄은 '<상대 이름/직함>님, 믿는구석 <담당자 이름>입니다'. 다음 단계(통화·미팅 일정 등)를 묻고 끝냅니다. 이모지는 최대 1개.",
          "현재 단계에 맞춥니다: 문의 → 통화 시간 요청, 요청 대응중 → 자료 전달·미팅 제안, 미팅 → 미팅 요약과 제안 일정, 제안·견적 → 검토 상황 확인과 조정 제안, 대기 → 약속한 확인일 연락, 보류 → 안부 겸 재접촉.",
          "상담 이력에 없는 약속·가격·사례는 지어내지 않습니다. 필요하면 [대괄호]로 채울 자리를 남깁니다.",
        ].join("\n"),
        user: context,
      });
      log("info", "inquiry-ai done", { action, kind, by: caller.userId, inquiry: inquiryId, ms: Date.now() - started });
      return reply({ ok: true, draft: String(out.text ?? "") });
    }

    // summarize
    const transcript = String(body.transcript ?? "").trim();
    if (!transcript) throw new UserError("녹취 텍스트를 붙여넣으세요.");
    if (transcript.length > 60000) throw new UserError("녹취가 너무 깁니다 (6만 자 이하).");
    const list = { type: "array", items: str };
    const out = await askClaude<{ key: string[]; decided: string[]; ours: string[]; theirs: string[] }>(client, {
      effort: "medium", maxTokens: 6000, schema: obj({ key: list, decided: list, ours: list, theirs: list }),
      system: [
        `당신은 ${COMPANY}의 미팅 기록 담당입니다. 고객 미팅 녹취를 읽고 요약합니다.`,
        "key: 상대의 상황·요구·예산·경쟁 등 핵심 (최대 5개). decided: 미팅에서 확정·합의한 것. ours: 우리(믿는구석)가 할 일 — 기한이 있으면 함께. theirs: 상대가 할 일.",
        "각 항목은 한 문장의 한국어. 녹취에 없는 내용은 쓰지 않고, 해당 내용이 없으면 빈 배열로 둡니다.",
      ].join("\n"),
      user: `참고용 카드 정보:\n${context}\n\n미팅 녹취:\n<녹취>\n${transcript}\n</녹취>`,
    });
    const li = (a: string[]) => (a?.length ? a.map((x) => `- ${x}`).join("\n") : "- (해당 내용 없음)");
    const text = `핵심\n${li(out.key)}\n\n결정한 것\n${li(out.decided)}\n\n우리가 할 일\n${li(out.ours)}\n\n상대가 할 일\n${li(out.theirs)}`;
    log("info", "inquiry-ai done", { action, by: caller.userId, inquiry: inquiryId, ms: Date.now() - started });
    return reply({ ok: true, summary: text });
  } catch (e) {
    if (e instanceof UserError) return reply({ error: e.message }, e.status);
    // Claude API 오류: 구체적인 것부터
    if (e instanceof Anthropic.AuthenticationError) { log("error", "inquiry-ai auth error", { action }); return reply({ error: "AI 키가 올바르지 않습니다. 관리자에게 확인을 요청해 주세요." }, 503); }
    if (e instanceof Anthropic.RateLimitError) { log("warn", "inquiry-ai rate limited", { action }); return reply({ error: "AI 요청이 많습니다. 잠시 후 다시 시도해 주세요." }, 429); }
    if (e instanceof Anthropic.APIConnectionError) { log("warn", "inquiry-ai connection error", { action, error: errorMessage(e, [apiKey]) }, [apiKey]); return reply({ error: "AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502); }
    if (e instanceof Anthropic.APIError) { log("error", "inquiry-ai api error", { action, status: e.status ?? 0 }); return reply({ error: "AI 요청이 실패했습니다. 잠시 후 다시 시도해 주세요." }, 502); }
    log("error", "inquiry-ai failed", { action, error: errorMessage(e, [apiKey]) }, [apiKey]);
    return reply({ error: "처리하지 못했습니다." }, 500);
  }
});
