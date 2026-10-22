// 변경 이력 (오너·관리자): 누가 언제 무엇을 바꿨는지. 링크 토큰·비밀값은 기록하지 않는다(DB 트리거)
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";
import ClientTabs from "@/components/ClientTabs";

export const metadata = { title: "변경 이력 · 리포트 포털" };
export const dynamic = "force-dynamic";

const TABLE: Record<string, string> = {
  clients: "광고주 정보", client_services: "리포트 계약 항목", client_ad_channels: "온라인 광고 채널", client_staff: "담당 직원",
  client_month_contracts: "월 계약", client_contract_items: "계약 항목", client_quotes: "견적서 · 계약서", client_access_tokens: "광고주 링크",
  staff_roles: "직원", task_members: "업무 보드 멤버", team_tasks: "업무",
};
const FIELD: Record<string, string> = {
  name: "이름", category: "업종", area: "지역", logo_path: "로고", service: "업무", monthly_target: "월 목표", channel: "채널", contracted: "계약",
  api_connected: "API 연결", monthly_budget: "월 예산", is_primary: "주담당", user_id: "직원", period: "월", amount: "계약 금액", starts_on: "시작일",
  ends_on: "종료일", memo: "메모", label: "세부 내용", quantity: "수량", done_count: "진행 수량", due_on: "마감일", extra: "추가 업무", note: "메모",
  file_name: "파일", kind: "종류", label_: "이름", expires_at: "만료", revoked_at: "폐기", role: "권한", display_name: "이름", job_title: "직급",
  duty: "담당 업무", email: "이메일", title: "업무", done: "완료", done_at: "완료 시각", member_id: "담당 멤버", repeat: "반복", client_id: "광고주",
  must_change_password: "비밀번호 변경 필요", invited_at: "초대", storage_path: "저장 위치", size_bytes: "크기", mime_type: "형식",
};
const HIDE = new Set(["client_id", "storage_path", "mime_type", "size_bytes", "invited_by", "invite_mailed_at", "contract_item_id", "auto", "member_id", "user_id"]);
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "없음" : v === true ? "예" : v === false ? "아니오" : String(v).slice(0, 60));
const kst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

function describe(changes: Record<string, unknown>, action: string) {
  return Object.entries(changes ?? {}).filter(([k]) => !HIDE.has(k)).slice(0, 6).map(([k, v]) =>
    action === "수정" && Array.isArray(v) ? `${FIELD[k] ?? k}: ${show(v[0])} → ${show(v[1])}` : `${FIELD[k] ?? k}: ${show(v)}`);
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const db = await supabaseForStaff();
  const clientId = sp.client && /^[0-9a-f-]{36}$/.test(sp.client) ? sp.client : undefined;
  let q = db.from("activity_logs").select("id, at, actor_name, table_name, action, client_id, changes").order("at", { ascending: false }).limit(300);
  if (clientId) q = q.eq("client_id", clientId);
  if (sp.table && TABLE[sp.table]) q = q.eq("table_name", sp.table);
  const [{ data: logs }, { data: clients }] = await Promise.all([q, db.from("clients").select("id, name").order("name")]);
  const name = new Map((clients ?? []).map((c) => [c.id, c.name]));

  return (
    <div className="ops">
      {clientId && <ClientTabs clientId={clientId} current="activity" isAdmin />}
      <header className="ops-head-in">
        <div><div className="faint">오너 · 관리자 전용</div><h1>변경 이력{clientId && <span className="h-sub">{name.get(clientId)}</span>}</h1></div>
        <form className="row" method="get">
          <select name="client" defaultValue={clientId ?? ""} aria-label="광고주"><option value="">전체 광고주</option>{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select name="table" defaultValue={sp.table ?? ""} aria-label="대상"><option value="">전체 항목</option>{Object.entries(TABLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn sm">보기</button>
        </form>
      </header>
      <section className="card mt">
        <ul className="log-list">
          {(logs ?? []).length === 0 && <li className="faint pad-x">기록이 없습니다.</li>}
          {(logs ?? []).map((l) => (
            <li key={l.id}>
              <span className="log-at num">{kst(l.at)}</span>
              <span className="log-who">{l.actor_name ?? "자동 작업"}</span>
              <span className="log-what">
                <span className={`badge ${l.action === "삭제" ? "bad" : l.action === "추가" ? "good" : ""}`}>{l.action}</span>
                <b>{TABLE[l.table_name] ?? l.table_name}</b>
                {l.client_id && name.get(l.client_id) && <Link href={`/admin/activity?client=${l.client_id}`} className="faint">{name.get(l.client_id)}</Link>}
                <span className="log-diff">{describe(l.changes as Record<string, unknown>, l.action).join(" · ")}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <p className="faint mt-s">최근 300건까지 보여줍니다.</p>
    </div>
  );
}
