"use client";
// 미집행 광고 채널을 중간에 계약했을 때 (직원 경로에서만 서버가 그린다). DB 규칙이 담당 여부를 다시 확인한다.
import { ask } from "@/components/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

// compact: 대시보드 카드 안에서는 버튼만
// inHouse: 자사 마케팅 — '계약' 대신 '집행'
export default function AdContractButton({ clientId, channel, label, compact = false, inHouse = false }: { clientId: string; channel: string; label: string; compact?: boolean; inHouse?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  async function contract() {
    if (!await ask(`${label}를 ${inHouse ? "집행" : "계약된"} 채널로 바꿀까요?\n월 예산과 광고 계정 연결은 광고주 설정에서 이어서 입력합니다.`)) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().from("client_ad_channels")
      .upsert({ client_id: clientId, channel, contracted: true, updated_at: new Date().toISOString() }, { onConflict: "client_id,channel" }).select("channel");
    setBusy(false);
    if (error || !data?.length) { setErr(true); return; }
    router.refresh();
  }
  return (
    <span className="row">
      <button className={`btn primary ${compact ? "sm" : ""}`} disabled={busy} onClick={contract}>{busy ? "처리 중…" : compact ? "+ 추가하기" : `+ ${label} ${inHouse ? "집행 추가" : "계약 추가"}`}</button>
      {!compact && <Link className="btn" href={`/admin/clients/${clientId}/settings`}>광고주 설정</Link>}
      {err && <span className="badge bad">저장하지 못했습니다. 광고주 설정에서 변경해 주세요.</span>}
    </span>
  );
}
