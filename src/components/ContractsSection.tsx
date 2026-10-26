// 계약 · 견적 관리 (직원 경로 전용, 서버 컴포넌트): 매월 새로 맺는 계약 내용과 견적서·계약서 파일
// 조회는 로그인 세션으로 직접 → RLS가 담당 여부를 확인. 저장은 ContractManager 가 DB 함수로 한다.
import "server-only";
import Link from "next/link";
import { supabaseForStaff } from "@/lib/supabase/server";
import { currentPeriod } from "@/lib/content";
import { getMonthOverview, monthInfo } from "@/lib/month";
import ContractManager from "./ContractManager";

const shift = (period: string, n: number) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

// inHouse: 자사 마케팅 — 계약 금액 · 기간 · 견적서 없이 업무 항목만
export default async function ContractsSection({ clientId, requested, inHouse = false }: { clientId: string; requested?: string; inHouse?: boolean }) {
  const period = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : currentPeriod();
  const prev = shift(period, -1);
  const db = await supabaseForStaff();
  const [head, items, prevItems, files, months, overview] = await Promise.all([
    db.from("client_month_contracts").select("amount, starts_on, ends_on, memo, updated_at").eq("client_id", clientId).eq("period", period).maybeSingle(),
    db.from("client_contract_items").select("id, service, label, quantity, done_count, due_on, extra, note").eq("client_id", clientId).eq("period", period).order("sort"),
    db.from("client_contract_items").select("service, label, quantity, due_on, extra").eq("client_id", clientId).eq("period", prev).order("sort"),
    db.from("client_quotes").select("id, storage_path, file_name, kind, size_bytes, created_at").eq("client_id", clientId).eq("period", period).order("created_at", { ascending: false }),
    db.from("client_month_contracts").select("period, amount").eq("client_id", clientId).order("period", { ascending: false }).limit(24),
    getMonthOverview(period, clientId),
  ]);
  const auto = new Map((overview[0]?.items ?? []).filter((i) => i.id && i.auto).map((i) => [i.id!, i.done]));
  const mi = monthInfo(period);
  const cur = currentPeriod();
  const tabs = [...new Set([shift(cur, 1), cur, ...(months.data ?? []).map((m) => m.period)])].sort().reverse();

  return (
    <>
      <div className="row period-bar">
        <div className="seg">
          {tabs.slice(0, 8).map((p) => (
            <Link key={p} href={`?period=${p}`} className={p === period ? "on" : ""}>
              {p.replace("-", ".")}{p === cur ? " (이번 달)" : p > cur ? " (다음 달)" : ""}{!inHouse && !(months.data ?? []).some((m) => m.period === p) && p <= cur ? " · 미등록" : ""}
            </Link>
          ))}
        </div>
        <Link href={`/admin/progress/${clientId}?period=${period}`} className="btn sm">진행 현황 그래프 보기</Link>
      </div>
      <ContractManager
        key={period}
        clientId={clientId} inHouse={inHouse} period={period} monthLabel={mi.label} lastDay={mi.last} isCurrent={period === cur}
        head={head.data ? { amount: head.data.amount, startsOn: head.data.starts_on, endsOn: head.data.ends_on, memo: head.data.memo, updatedAt: head.data.updated_at } : null}
        items={(items.data ?? []).map((i) => ({ id: i.id, service: i.service, label: i.label ?? "", quantity: String(i.quantity), dueOn: i.due_on, extra: i.extra, note: i.note ?? "", doneCount: i.done_count, autoDone: auto.get(i.id) ?? null }))}
        prevItems={(prevItems.data ?? []).filter((i) => !i.extra).map((i) => ({ service: i.service, label: i.label ?? "", quantity: i.quantity, day: Number(i.due_on.slice(8, 10)) }))}
        files={files.data ?? []}
      />
    </>
  );
}
