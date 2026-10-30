// 업무관리 · 문의관리: 영업 문의 카드 보드 · 목록 · 통계 · 설정
// 직원 누구나 모든 문의를 본다. 단계 변경 · 계약 처리는 담당 또는 관리자, 설정 수정은 관리자 (DB 규칙이 다시 확인)
import { isAdminRole, requireStaff } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";
import { kstDate } from "@/lib/month";
import InquiryApp from "./InquiryApp";
import { EVENT_COLS, INQUIRY_COLS, type Inquiry, type IqEvent, type MonthlySummary, type Settings, type StaffUser } from "./model";

export const metadata = { title: "문의관리 · 리포트 포털" };
export const dynamic = "force-dynamic";

const VIEWS = ["all", "board", "waiting", "hold", "won", "lost", "list", "stats", "settings"] as const;

export default async function InquiriesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const me = await requireStaff();
  const db = await supabaseForStaff();
  const sp = await searchParams;
  const v = typeof sp.view === "string" ? sp.view : "";
  const [cards, events, settings, staff, summaries] = await Promise.all([
    db.from("inquiries").select(INQUIRY_COLS).order("received_on", { ascending: false }).order("no", { ascending: false }).limit(5000),
    db.from("inquiry_events").select(EVENT_COLS).order("created_at").limit(20000),
    db.from("inquiry_settings").select("channels, services, lost_reasons, sla").eq("id", 1).maybeSingle(),
    db.rpc("inquiry_staff"),
    db.from("inquiry_monthly_summaries").select("id, period, body, created_at").order("created_at", { ascending: false }).limit(30),
  ]);
  if (cards.error) {
    return (
      <div className="ops">
        <div className="notice">문의 자료를 불러오지 못했습니다. (DB 마이그레이션 20261030004900_inquiries 적용 여부를 확인하세요)</div>
      </div>
    );
  }
  return (
    <div className="ops iq-page">
      <InquiryApp
        today={kstDate()}
        meId={me.userId}
        isAdmin={isAdminRole(me.role)}
        initialView={(VIEWS as readonly string[]).includes(v) ? v : "board"}
        cards={(cards.data ?? []) as Inquiry[]}
        events={(events.data ?? []) as IqEvent[]}
        settings={(settings.data ?? { channels: [], services: [], lost_reasons: [], sla: {} }) as Settings}
        staff={(staff.data ?? []) as StaffUser[]}
        summaries={(summaries.data ?? []) as MonthlySummary[]}
      />
    </div>
  );
}
