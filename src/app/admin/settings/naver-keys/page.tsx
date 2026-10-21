// 관리자: 네이버 검색광고 API 키 관리
// - 키 원문은 이 페이지 서버 코드를 거치지 않는다. 입력 폼(브라우저)이 Supabase 수집 작업으로 직접 보낸다.
// - 표시는 끝 4자리와 상태만 (admin_naver_account_status: DB에서 관리자 여부 재확인)
import { requireAdmin } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";
import KeyForm from "./KeyForm";

export const metadata = { title: "네이버 API 키 관리 · 리포트 포털" };

const kst = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "-");

export default async function NaverKeysPage() {
  await requireAdmin();
  const db = await supabaseForStaff();
  const [{ data: clients }, { data: status }, { data: audits }] = await Promise.all([
    db.from("clients").select("id, name").order("name"),
    db.rpc("admin_naver_account_status"),
    db.from("naver_key_audit_logs").select("client_id, action, actor_email, created_at").order("created_at", { ascending: false }).limit(20),
  ]);
  const rows = (status ?? []) as { client_id: string; customer_id_last4: string; access_license_last4: string; secret_key_last4: string; is_active: boolean; updated_at: string }[];
  const name = (id: string) => clients?.find((c) => c.id === id)?.name ?? "-";
  const ACTION: Record<string, string> = { create: "등록", update: "교체", delete: "삭제", deactivate: "비활성화" };

  return (
    <div className="ops">
      <h1>네이버 검색광고 API 키 관리</h1>
      <p className="muted">키는 입력 즉시 네이버 API로 연결을 확인한 뒤 암호화되어 저장됩니다. 저장된 키 원문은 누구도 다시 볼 수 없고, 교체는 새 값으로 덮어쓰기만 가능합니다.</p>

      <section className="card pad mt">
        <h2>등록 현황</h2>
        <div className="tbl-wrap mt"><table>
          <thead><tr><th>광고주</th><th>CUSTOMER_ID</th><th>액세스라이선스</th><th>비밀키</th><th>상태</th><th>최근 변경</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="faint">등록된 키가 없습니다.</td></tr>}
            {rows.map((r) => (
              <tr key={r.client_id}>
                <td><b>{name(r.client_id)}</b></td>
                <td className="num">****{r.customer_id_last4}</td><td className="num">****{r.access_license_last4}</td><td className="num">****{r.secret_key_last4}</td>
                <td>{r.is_active ? <span className="badge good">사용 중</span> : <span className="badge">비활성</span>}</td>
                <td className="faint">{kst(r.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>

      <section className="card pad mt">
        <h2>키 등록 · 교체 / 수동 재수집</h2>
        <KeyForm clients={(clients ?? []).map((c) => ({ id: c.id, name: c.name }))} />
      </section>

      <section className="card pad mt">
        <h2>변경 이력</h2>
        <ul className="list">
          {(audits ?? []).length === 0 && <li className="faint">변경 이력이 없습니다.</li>}
          {(audits ?? []).map((a, i) => (
            <li key={i}><span><b>{name(a.client_id)}</b> · {ACTION[a.action] ?? a.action}</span><span className="faint">{a.actor_email} · {kst(a.created_at)}</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
