// 광고주 API 키 암호화 (AES-256-GCM)
// - 마스터키는 Supabase 비밀값 ENCRYPTION_KEY(base64, 32바이트)에만 있다. 코드·DB·Git에 두지 않는다.
// - 저장 형식: "v1:" + base64(iv(12바이트) | 암호문+인증태그)
// - 복호화한 값은 호출한 함수 안에서만 쓰고 전역에 보관하지 않는다.

export type NaverCredentials = {
  customerId: string;
  accessLicense: string;
  secretKey: string;
};

const VERSION = "v1";

async function importMasterKey(): Promise<CryptoKey> {
  const b64 = Deno.env.get("ENCRYPTION_KEY");
  if (!b64) throw new Error("ENCRYPTION_KEY is not configured");
  const raw = Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (base64)");
  // extractable=false: 가져온 키를 다시 꺼낼 수 없게 한다
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return key;
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function encryptCredentials(creds: NaverCredentials): Promise<string> {
  const key = await importMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(creds));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  plain.fill(0);
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return `${VERSION}:${toB64(out)}`;
}

export async function decryptCredentials(payload: string): Promise<NaverCredentials> {
  const [version, body] = payload.split(":", 2);
  if (version !== VERSION || !body) throw new Error("unsupported key payload");
  const key = await importMasterKey();
  const bytes = fromB64(body);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)),
  );
  const creds = JSON.parse(new TextDecoder().decode(plain)) as NaverCredentials;
  plain.fill(0);
  return creds;
}

export const last4 = (v: string) => v.slice(-4);

// 광고주 링크 토큰 등 짧은 문자열 암호화 (같은 마스터키, 용도 문자열을 추가 인증 데이터로 묶어 다른 용도 값과 섞어 쓸 수 없게 한다)
export async function encryptText(text: string, purpose: string): Promise<string> {
  const key = await importMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(text);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(purpose) }, key, plain));
  plain.fill(0);
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return `${VERSION}:${toB64(out)}`;
}

export async function decryptText(payload: string, purpose: string): Promise<string> {
  const [version, body] = payload.split(":", 2);
  if (version !== VERSION || !body) throw new Error("unsupported payload");
  const key = await importMasterKey();
  const bytes = fromB64(body);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(purpose) }, key, bytes.slice(12));
  return new TextDecoder().decode(plain);
}
