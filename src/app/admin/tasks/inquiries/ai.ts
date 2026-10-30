"use client";
// 문의관리 AI 도우미 호출 (Supabase 함수 inquiry-ai). Claude API 키는 함수 비밀값에만 있고 브라우저에는 오지 않는다.
import { supabaseBrowser } from "@/lib/supabase/browser";

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function callAi<T>(body: Record<string, unknown>): Promise<AiResult<T>> {
  const { data, error } = await supabaseBrowser().functions.invoke("inquiry-ai", { body });
  if (error) {
    let msg = "AI 요청이 실패했습니다. 잠시 후 다시 시도해 주세요.";
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = String(j.error); } catch { /* 본문 없음 */ }
    return { ok: false, error: msg };
  }
  return { ok: true, data: data as T };
}
