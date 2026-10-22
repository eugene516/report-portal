// 데이터 업로드 (담당 직원 · 관리자): ego-browser 수집 결과 / 엑셀 붙여넣기
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdminRole, requireStaff } from "@/lib/auth";
import ClientTabs from "@/components/ClientTabs";
import { currentPeriod } from "@/lib/content";
import { supabaseForStaff } from "@/lib/supabase/server";
import UploadForms from "./UploadForms";

export const metadata = { title: "데이터 업로드 · 리포트 포털" };
export const dynamic = "force-dynamic";

export default async function UploadPage({ params }: { params: Promise<{ clientId: string }> }) {
  const me = await requireStaff();
  const { clientId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(clientId)) notFound();
  const db = await supabaseForStaff();
  const { data: client } = await db.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) notFound();
  const { data: uploads } = await db.from("data_uploads").select("kind, item_count, note, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(10);
  return (
    <div className="ops narrow-wide">
      <ClientTabs clientId={clientId} current="upload" isAdmin={isAdminRole(me.role)} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><div className="faint">데이터 업로드</div><h1>{client.name}</h1></div>
        <div className="row">
          <Link href={`/admin/clients/${clientId}`} className="btn">리포트 보기</Link>
          <Link href={`/admin/clients/${clientId}/settings`} className="btn">광고주 설정</Link>
          <Link href="/admin" className="btn">← 홈</Link>
        </div>
      </div>
      <UploadForms clientId={clientId} defaultPeriod={currentPeriod()} recent={uploads ?? []} />
    </div>
  );
}
