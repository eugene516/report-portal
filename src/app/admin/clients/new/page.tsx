// 새 광고주 만들기 (직원 누구나 — 만든 직원이 주담당)
import { requireStaff } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";
import NewClientForm from "./NewClientForm";

export const metadata = { title: "새 광고주 · 리포트 포털" };
export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const me = await requireStaff();
  const db = await supabaseForStaff();
  const { data } = await db.rpc("staff_directory");
  const others = ((data ?? []) as { id: string; name: string; email: string }[]).filter((s) => s.id !== me.userId);
  return (
    <div className="ops narrow-wide">
      <h1>새 광고주 만들기</h1>
      <p className="muted">견적서를 첨부하고, 견적서의 계약 내용에 맞춰 진행할 마케팅 항목을 선택하세요. 선택한 항목에 따라 리포트 메뉴가 구성됩니다. 만든 사람이 주담당이 됩니다.</p>
      <NewClientForm staff={others} />
    </div>
  );
}
