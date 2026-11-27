"use client";
// 견적서 메뉴(직원 화면)에서 잘못 올린 파일 삭제
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ask, toast, toastError } from "@/components/ui";
import { deleteQuote } from "./quotes";

export default function QuoteDeleteButton({ id, path, name }: { id: string; path: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!(await ask(`‘${name}’ 파일을 삭제할까요?\n광고주 화면에서도 사라집니다. 이미 계약에 반영한 내용은 그대로 남습니다.`))) return;
    setBusy(true);
    const ok = await deleteQuote(supabaseBrowser(), { id, storage_path: path });
    setBusy(false);
    if (!ok) return toastError("파일을 삭제하지 못했습니다.");
    toast("파일을 삭제했습니다."); router.refresh();
  }
  return <button type="button" className="btn sm ghost" disabled={busy} onClick={run}>삭제</button>;
}
