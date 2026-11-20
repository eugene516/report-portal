// 파일 검수: 화면에서 고친 Word 원고 저장 (블로그 · 홈페이지 칼럼)
// POST multipart/form-data: fileId, file(.docx)
// - 직원(담당 · 관리자): 검수 완료 전 항목의 지금 버전 · 다음 수정본 파일
// - 광고주 계정: 자기 병원 항목이 '검수 대기'일 때 지금 버전 파일만
// - 새 파일을 올리고 기록(review_files)의 저장 경로를 바꾼다. 처음 올린 원본은 original_path 로 보관하고, 중간 수정본은 지운다
import { corsHeaders, getCaller, json, serviceClient, withCors } from "../_shared/common.ts";
import { errorMessage, log } from "../_shared/log.ts";

const UUID = /^[0-9a-f-]{36}$/;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const reply = (body: unknown, status = 200) => withCors(req, json(body, status));
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller) return reply({ error: "forbidden" }, 403);
  let form: FormData;
  try { form = await req.formData(); } catch { return reply({ error: "invalid body" }, 400); }
  const fileId = String(form.get("fileId") ?? "");
  const blob = form.get("file");
  if (!UUID.test(fileId) || !(blob instanceof File)) return reply({ error: "invalid body" }, 400);
  if (blob.size < 100 || blob.size > 30 * 1024 * 1024) return reply({ error: "파일 크기가 올바르지 않습니다." }, 400);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return reply({ error: "Word 파일이 아닙니다." }, 400);   // zip(PK) 머리

  const db = serviceClient();
  const { data: f } = await db.from("review_files").select("id, item_id, client_id, version, file_name, storage_path, original_path, edit_count").eq("id", fileId).maybeSingle();
  if (!f || !/\.docx$/i.test(f.file_name)) return reply({ error: "forbidden" }, 403);
  const { data: it } = await db.from("review_items").select("id, client_id, kind, status, version").eq("id", f.item_id).maybeSingle();
  if (!it || it.client_id !== f.client_id || !["blog", "column"].includes(it.kind)) return reply({ error: "forbidden" }, 403);

  // 누가 고치는지
  let kind: "staff" | "client";
  let who: string;
  if (await caller.canAccess(it.client_id)) {
    if (it.status === "approved" || f.version < it.version) return reply({ error: "검수 완료되었거나 지난 버전 원고는 수정할 수 없습니다." }, 409);
    const { data: s } = await db.from("staff_roles").select("display_name, email").eq("user_id", caller.userId).maybeSingle();
    kind = "staff"; who = s?.display_name || s?.email || caller.email || "담당자";
  } else {
    const { data: cu } = await db.from("client_users").select("name, email").eq("user_id", caller.userId).eq("client_id", it.client_id).maybeSingle();
    if (!cu) return reply({ error: "forbidden" }, 403);
    if (it.status !== "pending" || f.version !== it.version) return reply({ error: "검수 대기 중인 원고만 수정할 수 있습니다." }, 409);
    kind = "client"; who = cu.name || cu.email || "광고주";
  }

  const path = `${it.client_id}/${crypto.randomUUID()}.docx`;
  const up = await db.storage.from("reviews").upload(path, bytes, { contentType: DOCX, upsert: false });
  if (up.error) { log("error", "review-edit upload", { err: errorMessage(up.error) }); return reply({ error: "저장하지 못했습니다." }, 500); }

  // 다른 사람이 먼저 저장했으면(경로가 바뀜) 덮어쓰지 않는다
  const { data: upd, error } = await db.from("review_files")
    .update({ storage_path: path, original_path: f.original_path ?? f.storage_path, size_bytes: bytes.length, mime_type: DOCX,
              edited_at: new Date().toISOString(), edited_by_name: who, edit_count: (f.edit_count ?? 0) + 1 })
    .eq("id", f.id).eq("storage_path", f.storage_path).select("id");
  if (error || !upd?.length) {
    await db.storage.from("reviews").remove([path]);
    return reply({ error: error ? "저장하지 못했습니다." : "다른 사람이 먼저 수정했습니다. 새로고침 후 다시 수정해 주세요." }, error ? 500 : 409);
  }
  if (f.original_path) await db.storage.from("reviews").remove([f.storage_path]);   // 중간 수정본 (원본은 남긴다)
  await db.from("review_events").insert({ item_id: it.id, client_id: it.client_id, version: f.version, action: "edit", comment: `${f.file_name} 원고 수정`, actor: caller.userId, actor_name: who, actor_kind: kind, file_id: f.id });
  return reply({ ok: true });
});
