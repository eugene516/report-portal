// 광고주 설정 (담당 직원 · 관리자)
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdminRole, requireStaff } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";
import ClientSettings from "./ClientSettings";

export const metadata = { title: "광고주 설정 · 리포트 포털" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireStaff();
  const { clientId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(clientId)) notFound();
  const db = await supabaseForStaff();
  const { data: client } = await db.from("clients").select("id, name, category, area").eq("id", clientId).maybeSingle();
  if (!client) notFound();   // 담당이 아니면 RLS로 조회되지 않는다
  const [svc, ch, assign, dir, quotes, tokens, keys] = await Promise.all([
    db.from("client_services").select("service, monthly_target").eq("client_id", clientId),
    db.from("client_ad_channels").select("channel, contracted, api_connected, monthly_budget").eq("client_id", clientId),
    db.from("client_staff").select("user_id, is_primary").eq("client_id", clientId),
    db.rpc("staff_directory"),
    db.from("client_quotes").select("id, storage_path, file_name, size_bytes, created_at").eq("client_id", clientId).order("created_at", { ascending: false }),
    db.from("client_access_tokens").select("id, label, created_at, expires_at, revoked_at, last_used_at").eq("client_id", clientId).order("created_at", { ascending: false }),
    db.rpc("admin_naver_account_status"),
  ]);
  const directory = (dir.data ?? []) as { id: string; name: string; email: string }[];
  // 주담당 먼저, 나머지는 직급 순(직원 목록 순서)
  const assigned = (assign.data ?? []).map((a) => ({ id: a.user_id, primary: a.is_primary, name: directory.find((d) => d.id === a.user_id)?.name ?? "(알 수 없음)" }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || directory.findIndex((d) => d.id === a.id) - directory.findIndex((d) => d.id === b.id));
  const canManageStaff = isAdminRole(me.role) || assigned.some((a) => a.id === me.userId && a.primary);
  const key = ((keys.data ?? []) as { client_id: string; customer_id_last4: string; access_license_last4: string; secret_key_last4: string; is_active: boolean; updated_at: string }[]).find((k) => k.client_id === clientId) ?? null;

  return (
    <div className="ops narrow-wide">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><div className="faint">광고주 설정</div><h1>{client.name}</h1></div>
        <div className="row">
          <Link href={`/admin/clients/${clientId}`} className="btn">리포트 보기</Link>
          <Link href={`/admin/clients/${clientId}/upload`} className="btn">데이터 업로드</Link>
          <Link href="/admin" className="btn">← 홈</Link>
        </div>
      </div>
      {sp.created && <div className="planned mt">광고주를 만들었습니다. 아래에서 API 키 등록과 광고주 링크 발급을 이어서 진행하세요.</div>}
      {sp.warn && <div className="notice mt">일부 항목을 저장하지 못했습니다: {sp.warn}. 아래에서 다시 설정해 주세요.</div>}
      <ClientSettings
        client={client}
        services={Object.fromEntries((svc.data ?? []).map((s) => [s.service, { on: true, target: s.monthly_target == null ? "" : String(s.monthly_target) }]))}
        channels={Object.fromEntries((ch.data ?? []).map((c) => [c.channel, { contracted: c.contracted, apiConnected: c.api_connected, budget: c.monthly_budget }]))}
        assigned={assigned} directory={directory} canManageStaff={canManageStaff} isAdmin={isAdminRole(me.role)}
        quotes={quotes.data ?? []} tokens={tokens.data ?? []} naverKey={key}
      />
    </div>
  );
}
