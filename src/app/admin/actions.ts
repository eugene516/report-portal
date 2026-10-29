"use server";
// 서버 액션: 견적서 반영 등 (광고주 링크 발급 · 다시 보기는 client-link 함수)
import { requireStaff } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";
import { parseQuote } from "@/lib/quote";
import { currentPeriod } from "@/lib/content";

// 견적서를 읽어 그달 계약에 반영한다 (PDF · 엑셀). 이미지 견적서는 읽을 수 없어 직접 입력 안내
// - 견적서에 있는 업무 → 계약 항목(수량 · 마감 말일), 없는 업무 → 미집행, 광고 매체 → 광고 채널 계약
// - 권한: 로그인 직원 + DB 함수가 담당 여부를 다시 확인
export async function applyQuote(quoteId: string): Promise<{ ok?: string; error?: string }> {
  await requireStaff();
  if (!/^[0-9a-f-]{36}$/.test(quoteId)) return { error: "잘못된 요청입니다." };
  const db = await supabaseForStaff();
  const { data: q } = await db.from("client_quotes").select("id, client_id, period, storage_path, mime_type, file_name, kind").eq("id", quoteId).maybeSingle();
  if (!q || q.kind !== "quote") return { error: "견적서를 찾지 못했습니다." };
  const { data: blob, error: de } = await db.storage.from("quotes").download(q.storage_path);
  if (de || !blob) return { error: "견적서 파일을 열지 못했습니다." };
  let text = "";
  try {
    if (/pdf$/i.test(q.mime_type ?? "") || /\.pdf$/i.test(q.file_name)) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      text = (await extractText(await getDocumentProxy(new Uint8Array(await blob.arrayBuffer())), { mergePages: true })).text;
    } else if (/\.xlsx$/i.test(q.file_name)) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await blob.arrayBuffer());
      const rows: string[] = [];
      wb.eachSheet((ws) => ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" ? ((v as { text?: string; result?: unknown }).text ?? String((v as { result?: unknown }).result ?? "")) : String(v ?? ""))).filter(Boolean).join(" "))));
      text = rows.join("\n");
    } else return { error: "PDF · 엑셀 견적서만 자동으로 읽을 수 있습니다. 계약 내용을 직접 입력해 주세요." };
  } catch { return { error: "견적서 내용을 읽지 못했습니다. 계약 내용을 직접 입력해 주세요." }; }
  const p = parseQuote(text);
  if (p.items.length === 0) return { error: "견적서에서 계약 항목을 찾지 못했습니다. 계약 내용을 직접 입력해 주세요." };
  const period = q.period ?? p.period ?? currentPeriod();
  const memo = `견적서(${q.file_name}) 자동 반영${p.vatAmount ? ` · 부가세 포함 ${p.vatAmount.toLocaleString("ko-KR")}원` : ""}${p.channels.length ? " · 광고비 실비 별도" : ""}`;
  const { error } = await db.rpc("apply_quote_contract", { p_client: q.client_id, p_period: period, p_amount: p.amount ?? p.vatAmount, p_memo: memo, p_items: p.items, p_channels: p.channels });
  if (error) return { error: "계약에 반영하지 못했습니다." };
  await db.from("client_quotes").update({ applied_at: new Date().toISOString(), period }).eq("id", q.id);
  const LABEL: Record<string, string> = { blog: "블로그", column: "홈페이지 칼럼", cardnews: "카드뉴스", cafe: "카페", daangn: "당근 바이럴", review: "리뷰", place: "플레이스", aeo: "AEO" };
  const CH: Record<string, string> = { naver: "네이버", daangn: "당근", kakao: "카카오" };
  return { ok: `견적서를 계약에 반영했습니다: ${p.items.map((i) => (i.service === "place" ? "플레이스(고정 키워드)" : `${LABEL[i.service] ?? i.service} ${i.quantity}`)).join(" · ")}${p.channels.length ? ` / 광고 ${p.channels.map((c) => CH[c]).join("·")}` : ""}` };
}
