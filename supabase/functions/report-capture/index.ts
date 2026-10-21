// 광고주 링크 화면용 캡쳐 열람
// GET ?t={광고주 링크 토큰}&p={captures 버킷 안 경로}
// - 토큰을 DB에서 검증하고, 경로의 첫 폴더(client_id)가 그 광고주와 같을 때만
//   2분짜리 서명 주소로 이동시킨다. 다른 광고주 캡쳐는 열 수 없다.
// - 직원 화면은 이 함수를 쓰지 않고 로그인 세션으로 직접 서명 주소를 만든다.
import { serviceClient } from "../_shared/common.ts";

const PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._\-\/가-힣]{1,200}\.(png|jpe?g|webp)$/;

Deno.serve(async (req) => {
  const deny = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  if (req.method !== "GET") return deny(405);
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const path = url.searchParams.get("p") ?? "";
  if (token.length < 32 || !PATH.test(path) || path.includes("..")) return deny(404);

  const db = serviceClient();
  const { data: clientId } = await db.rpc("resolve_client_token", { p_token: token });
  if (!clientId || path.split("/")[0] !== clientId) return deny(404);   // 토큰 오류·다른 광고주 캡쳐: 구분 없이 404

  const { data, error } = await db.storage.from("captures").createSignedUrl(path, 120);
  if (error || !data?.signedUrl) return deny(404);
  return new Response(null, {
    status: 302,
    headers: { Location: data.signedUrl, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
});
