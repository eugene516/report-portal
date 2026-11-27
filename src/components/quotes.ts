"use client";
// 견적서·계약서 업로드: 비공개 저장소 quotes/{client_id}/... (저장소 규칙이 담당 여부를 확인)
import type { SupabaseClient } from "@supabase/supabase-js";

const safe = (name: string) => name.replace(/[^\w.\-가-힣]/g, "_").slice(-80);

// opts.period: 어느 달 계약 파일인지, opts.kind: 견적서(quote) · 계약서(contract)
export async function uploadQuotes(sb: SupabaseClient, clientId: string, files: File[], opts: { period?: string; kind?: "quote" | "contract" } = {}) {
  let failed = 0;
  const ids: string[] = [];
  for (const f of files) {
    if (f.size > 20 * 1024 * 1024) { failed++; continue; }
    const ext = (f.name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "").toLowerCase();
    const path = `${clientId}/${crypto.randomUUID()}${ext}`;   // 저장소 경로는 영문, 원래 이름은 DB에 기록
    const up = await sb.storage.from("quotes").upload(path, f, { contentType: f.type || undefined, upsert: false });
    if (up.error) { failed++; continue; }
    const ins = await sb.from("client_quotes").insert({ client_id: clientId, storage_path: path, file_name: safe(f.name), mime_type: f.type || null, size_bytes: f.size, period: opts.period ?? null, kind: opts.kind ?? "quote" }).select("id").single();
    if (ins.error || !ins.data) { await sb.storage.from("quotes").remove([path]); failed++; } else ids.push(ins.data.id);
  }
  return { failed, ids };
}

// 잘못 올린 견적서 · 계약서 삭제: 기록을 먼저 지우고(RLS 가 담당 여부 확인) 저장소 파일을 지운다
// (이미 '계약에 반영'한 내용은 그대로 남는다 — 계약 항목은 따로 고친다)
export async function deleteQuote(sb: SupabaseClient, q: { id: string; storage_path: string }) {
  const { data, error } = await sb.from("client_quotes").delete().eq("id", q.id).select("id");
  if (error || !data?.length) return false;
  await sb.storage.from("quotes").remove([q.storage_path]);
  return true;
}
