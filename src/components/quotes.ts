"use client";
// 견적서 업로드: 비공개 저장소 quotes/{client_id}/... (저장소 규칙이 담당 여부를 확인)
import type { SupabaseClient } from "@supabase/supabase-js";

const safe = (name: string) => name.replace(/[^\w.\-가-힣]/g, "_").slice(-80);

export async function uploadQuotes(sb: SupabaseClient, clientId: string, files: File[]) {
  let failed = 0;
  for (const f of files) {
    if (f.size > 20 * 1024 * 1024) { failed++; continue; }
    const ext = (f.name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "").toLowerCase();
    const path = `${clientId}/${crypto.randomUUID()}${ext}`;   // 저장소 경로는 영문, 원래 이름은 DB에 기록
    const up = await sb.storage.from("quotes").upload(path, f, { contentType: f.type || undefined, upsert: false });
    if (up.error) { failed++; continue; }
    const ins = await sb.from("client_quotes").insert({ client_id: clientId, storage_path: path, file_name: safe(f.name), mime_type: f.type || null, size_bytes: f.size });
    if (ins.error) { await sb.storage.from("quotes").remove([path]); failed++; }
  }
  return { failed };
}
