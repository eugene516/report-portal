// 내부 직원용 운영 대시보드
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { supabaseForStaff } from "@/lib/supabase/server";
import IssueLinkButton from "./IssueLinkButton";

export const metadata = { title: "운영 대시보드 · 리포트 포털" };

const kst = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ") : "-");

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const staff = await requireStaff();
  const { denied } = await searchParams;
  const db = await supabaseForStaff();
  const [{ data: clients }, { data: channels }, { data: logs }] = await Promise.all([
    db.from("clients").select("id, name, category, area").order("name"),
    db.from("client_ad_channels").select("client_id, channel, contracted, api_connected"),
    db.from("naver_sync_logs").select("client_id, status, rows_upserted, error_message, trigger_type, started_at").order("started_at", { ascending: false }).limit(50),
  ]);
  const ch = (id: string, c: string) => channels?.find((x) => x.client_id === id && x.channel === c);
  const lastLog = (id: string) => logs?.find((l) => l.client_id === id);
  const failures = (logs ?? []).filter((l) => l.status === "failed").slice(0, 10);
  const name = (id: string | null) => clients?.find((c) => c.id === id)?.name ?? "-";

  return (
    <div className="ops">
      {denied && <div className="notice">관리자만 사용할 수 있는 메뉴입니다.</div>}
      <h1>리포트 운영 대시보드</h1>

      <section className="card mt">
        <div className="card-h pad-h"><h2>광고주</h2><span className="faint">행의 리포트 열기 = 직원 화면(홈 버튼 표시) · 광고주 링크 = 광고주에게 보내는 주소(홈 버튼 없음)</span></div>
        <div className="tbl-wrap"><table className="ops-table">
          <thead><tr><th>광고주</th><th>네이버 광고</th><th>당근마켓</th><th>카카오</th><th>최근 수집</th><th></th></tr></thead>
          <tbody>
            {(clients ?? []).map((c) => {
              const l = lastLog(c.id);
              return (
                <tr key={c.id}>
                  <td><div className="cname">{c.name}</div><div className="faint">{[c.category, c.area].filter(Boolean).join(" · ")}</div></td>
                  {(["naver", "daangn", "kakao"] as const).map((k) => {
                    const s = ch(c.id, k);
                    return <td key={k}>{!s?.contracted ? <span className="faint">미집행</span> : s.api_connected ? <span className="badge good">연결됨</span> : <span className="badge warn">키 등록 필요</span>}</td>;
                  })}
                  <td>{l ? <><span className={`badge ${l.status === "success" ? "good" : l.status === "failed" ? "bad" : ""}`}>{l.status}</span> <span className="faint">{kst(l.started_at)}</span></> : <span className="faint">-</span>}</td>
                  <td className="r nowrap">
                    <Link className="btn sm" href={`/admin/clients/${c.id}`}>리포트 열기</Link>{" "}
                    {staff.role === "admin" && <IssueLinkButton clientId={c.id} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </section>

      <section className="card mt">
        <div className="card-h pad-h"><h2>확인 필요</h2><span className="faint">최근 수집 실패 (실패 시 등록된 직원 전원에게 메일 발송)</span></div>
        {failures.length === 0 ? <p className="faint pad-x">최근 실패한 수집이 없습니다.</p> : (
          <ul className="alerts">
            {failures.map((f, i) => (
              <li key={i}><div className="alert-row"><span className="lv high" /><span className="t"><b>{name(f.client_id)}</b><span>{f.error_message}</span></span><span className="faint">{kst(f.started_at)}</span></div></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
