// 광고주 링크 화면용 견적서 · 계약서 열람
// GET ?t={광고주 링크 토큰}&id={client_quotes.id}[&dl=1]
// - 토큰을 DB에서 검증하고, 그 광고주의 파일일 때만 2분짜리 서명 주소로 이동시킨다. 다른 광고주 파일은 열 수 없다.
// - 직원 화면은 이 함수를 쓰지 않고 로그인 세션으로 직접 서명 주소를 만든다.
import { serviceClient } from "../_shared/common.ts";

const UUID = /^[0-9a-f-]{36}$/;

Deno.serve(async (req) => {
  const deny = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  if (req.method !== "GET") return deny(405);
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (token.length < 32 || !UUID.test(id)) return deny(404);

  const db = serviceClient();
  const { data: clientId } = await db.rpc("resolve_client_token", { p_token: token });
  if (!clientId) return deny(404);
  const { data: q } = await db.from("client_quotes").select("storage_path, client_id, file_name").eq("id", id).maybeSingle();
  if (!q || q.client_id !== clientId) return deny(404);   // 토큰 오류 · 다른 광고주 파일: 구분 없이 404

  // dl=1: 원래 파일 이름으로 내려받기
  const download = url.searchParams.get("dl") === "1" ? { download: q.file_name || true } : undefined;
  const { data, error } = await db.storage.from("quotes").createSignedUrl(q.storage_path, 120, download);
  if (error || !data?.signedUrl) return deny(404);
  return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
});
