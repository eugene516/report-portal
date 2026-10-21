// 로그·에러 마스킹
// 로그, 에러 메시지, 수집 이력(error_message)에 키·서명·요청 헤더가 남지 않도록 한다.
// - 알려진 비밀값(현재 처리 중인 광고주 키)은 문자열 치환으로 가린다.
// - 헤더 이름 패턴(X-API-KEY, X-Signature, X-Customer, Authorization 등)과 긴 토큰 형태도 가린다.

const HEADER_PATTERN = /(x-api-key|x-signature|x-customer|x-timestamp|authorization|apikey|x-cron-secret)\s*[:=]\s*("?)[^\s",}]+/gi;
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{24,}/g;

export function mask(text: string, secrets: (string | undefined)[] = []): string {
  let out = String(text ?? "");
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("****" + s.slice(-4));
  }
  out = out.replace(HEADER_PATTERN, (_m, name) => `${name}: ****`);
  out = out.replace(LONG_TOKEN, (t) => "****" + t.slice(-4));
  return out.slice(0, 500);
}

export function errorMessage(e: unknown, secrets: (string | undefined)[] = []): string {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return mask(msg, secrets);
}

// console 대신 이 함수만 쓴다 (스택·요청 객체를 통째로 찍지 않는다)
export function log(level: "info" | "warn" | "error", message: string, meta: Record<string, unknown> = {}, secrets: (string | undefined)[] = []) {
  const safeMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    safeMeta[k] = typeof v === "string" ? mask(v, secrets) : typeof v === "number" || typeof v === "boolean" || v == null ? v : mask(JSON.stringify(v), secrets);
  }
  console[level](JSON.stringify({ level, message: mask(message, secrets), ...safeMeta }));
}
