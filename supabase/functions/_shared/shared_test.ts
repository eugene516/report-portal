// 단위 시험 (가짜 키만 사용). 실행: npx deno test --allow-env supabase/functions/_shared/shared_test.ts
import { decryptCredentials, encryptCredentials } from "./crypto.ts";
import { errorMessage, mask } from "./log.ts";
import { dateRange, kstDate } from "./common.ts";

const fake = { customerId: "1234567", accessLicense: "0100000000FAKEACCESSLICENSE1111", secretKey: "AQAAAAFAKESECRETKEYVALUE==2222" };

function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

Deno.test("AES-256-GCM 암호화: 왕복 복원, 매번 다른 암호문, 평문 미포함", async () => {
  Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
  const a = await encryptCredentials(fake);
  const b = await encryptCredentials(fake);
  assert(a !== b, "같은 값도 IV가 달라 암호문이 달라야 함");
  assert(!a.includes(fake.secretKey) && !a.includes(fake.accessLicense) && !a.includes(fake.customerId), "암호문에 평문이 보이면 안 됨");
  const back = await decryptCredentials(a);
  assert(back.secretKey === fake.secretKey && back.customerId === fake.customerId, "복호화 결과가 원본과 같아야 함");
});

Deno.test("다른 마스터키로는 복호화 실패", async () => {
  Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
  const enc = await encryptCredentials(fake);
  Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
  let failed = false;
  try { await decryptCredentials(enc); } catch { failed = true; }
  assert(failed, "마스터키가 다르면 복호화가 실패해야 함");
});

Deno.test("암호문 변조 시 복호화 실패 (GCM 인증)", async () => {
  Deno.env.set("ENCRYPTION_KEY", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
  const enc = await encryptCredentials(fake);
  const tampered = enc.slice(0, -6) + (enc.at(-6) === "A" ? "B" : "A") + enc.slice(-5);
  let failed = false;
  try { await decryptCredentials(tampered); } catch { failed = true; }
  assert(failed, "변조된 암호문은 거부되어야 함");
});

Deno.test("로그 마스킹: 키·서명·헤더가 남지 않음", () => {
  const line = `X-API-KEY: ${fake.accessLicense} X-Signature=abcdEFGHijklMNOPqrstUVWX123456== X-Customer: ${fake.customerId} secret=${fake.secretKey}`;
  const out = mask(line, [fake.customerId, fake.accessLicense, fake.secretKey]);
  assert(!out.includes(fake.accessLicense) && !out.includes(fake.secretKey) && !out.includes("abcdEFGHijklMNOPqrstUVWX123456"), "원문이 남으면 안 됨: " + out);
  assert(!out.includes(fake.customerId), "CUSTOMER_ID 원문이 남으면 안 됨: " + out);
  const em = errorMessage(new Error(`request failed with key ${fake.secretKey}`), [fake.secretKey]);
  assert(!em.includes(fake.secretKey), "에러 메시지에도 남으면 안 됨");
});

Deno.test("한국시간 날짜 계산: UTC 00:00 실행 시 어제 = 한국 전날", () => {
  const utcMidnight = new Date("2026-10-22T00:00:00Z");   // = KST 2026-10-22 09:00
  assert(kstDate(0, utcMidnight) === "2026-10-22", "오늘(KST)");
  assert(kstDate(-1, utcMidnight) === "2026-10-21", "어제(KST)");
  assert(kstDate(-7, utcMidnight) === "2026-10-15", "7일 전(KST)");
  assert(dateRange("2026-10-15", "2026-10-21").length === 7, "전일 포함 7일");
});
