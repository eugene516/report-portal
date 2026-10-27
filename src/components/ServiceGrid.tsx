// 내부용: 모든 업무 항목과 광고 채널을 기본 카드로 표시 (진행 현황 페이지 · 광고주 현황 자세히 보기)
// 계약된 항목 = 진행 도넛 + 다음 마감, 계약되지 않은 항목 = "미집행" + [+ 추가하기]
import Link from "next/link";
import { daysLeft, dday, type ContractItem, type MonthClient } from "@/lib/month";
import { Donut } from "./charts";
import AdContractButton from "./AdContractButton";

const WORK = [
  { svc: "blog", menu: "blog", label: "블로그" },
  { svc: "column", menu: "column", label: "홈페이지 칼럼" },
  { svc: "place", menu: "place", label: "플레이스" },
  { svc: "cafe", menu: "cafe", label: "카페 바이럴" },
  { svc: "daangn", menu: "daangn", label: "당근마켓 바이럴" },
  { svc: "cardnews", menu: "sns", label: "SNS 카드뉴스" },
] as const;
const ADS = [
  { id: "naver", label: "네이버 광고" },
  { id: "daangn", label: "당근마켓 광고" },
  { id: "kakao", label: "카카오 광고" },
] as const;

export default function ServiceGrid({ c, today, size = 92 }: { c: MonthClient; today: string; size?: number }) {
  const base = `/admin/clients/${c.id}`;
  const by = (svc: string) => c.items.filter((i: ContractItem) => i.service === svc);
  const others = c.items.filter((i) => !WORK.some((w) => w.svc === i.service));
  return (
    <>
      <div className="svc-cards">
        {WORK.map((w) => {
          const items = by(w.svc);
          const contracted = items.length > 0 || (c.services ?? []).includes(w.svc);
          if (!contracted) return (
            <div key={w.svc} className="card kpi donut-card off-card sm">
              <div className="label">{w.label}</div><div className="value">미집행</div>
              <div className="off-act"><Link className="btn sm primary" href={`${base}/${w.menu}?add=extra`}>+ 추가하기</Link></div>
            </div>
          );
          // 플레이스: 계약 수량 없이 고정 키워드를 매일 확인 (정상 노출 키워드 수)
          if (w.svc === "place") return (
            <Link key={w.svc} href={`${base}/place`} className="card kpi donut-card sm">
              <Donut done={c.place?.checked ?? 0} total={c.place?.total ?? 0} label="플레이스 순위 확인" size={size}
                sub={c.place?.total ? `오늘 9시 30분 ${c.place.checked}/${c.place.total}개 확인 · 정상 노출 ${c.place.ranked}개` : "키워드 미등록"} />
            </Link>
          );
          if (items.length === 0) return (
            <Link key={w.svc} href={`${base}/contracts`} className="card kpi donut-card sm">
              <div className="label">{w.label}</div><div className="value sm-v">진행</div><div className="foot">월 수량 미등록</div>
            </Link>
          );
          const qty = items.reduce((s, i) => s + i.quantity, 0);
          const done = items.reduce((s, i) => s + Math.min(i.done, i.quantity), 0);
          const extra = items.filter((i) => i.extra).reduce((s, i) => s + i.quantity, 0);
          const next = items.filter((i) => i.done < i.quantity).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
          return (
            <Link key={w.svc} href={`${base}/${w.menu}`} className="card kpi donut-card sm">
              <Donut done={done} total={qty} label={w.label} size={size}
                sub={`${next ? `마감 ${next.dueOn.slice(5).replace("-", "/")} · ${dday(daysLeft(next.dueOn, today))}` : "완료"}${extra ? ` · 추가 ${extra}` : ""}`} />
            </Link>
          );
        })}
        {others.length > 0 && (() => {
          const qty = others.reduce((s, i) => s + i.quantity, 0);
          const done = others.reduce((s, i) => s + Math.min(i.done, i.quantity), 0);
          return <Link href={`${base}/contracts`} className="card kpi donut-card sm"><Donut done={done} total={qty} label="기타 업무" sub={`항목 ${others.length}개`} size={size} /></Link>;
        })()}
      </div>
      <div className="svc-cards mt-s">
        {ADS.map((a) => {
          const st = c.channels[a.id];
          if (!st?.contracted) return (
            <div key={a.id} className="card kpi donut-card off-card sm ad">
              <div className="label">{a.label}</div><div className="value">미집행</div>
              <div className="off-act"><AdContractButton clientId={c.id} channel={a.id} label={a.label} compact /></div>
            </div>
          );
          const burn = st.budget ? Math.min(100, Math.round(((st.spent ?? 0) / st.budget) * 100)) : null;
          return (
            <Link key={a.id} href={`${base}/ads/${a.id}`} className="card kpi donut-card sm ad">
              <div className="label">{a.label}</div>
              <div className="value sm-v">{st.spent != null ? `${Math.round(st.spent).toLocaleString("ko-KR")}원` : "집행 중"}</div>
              <div className="foot">{!st.apiConnected ? "연결 준비 중" : burn != null ? `예산 대비 ${burn}% 소진` : "월 예산 미입력"}</div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
