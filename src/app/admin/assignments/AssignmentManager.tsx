"use client";
// 광고주별 담당 직원 변경 화면
// - 저장은 DB 함수 set_client_staff 한 번으로 처리 (오너·관리자만 허용, 주담당·보조를 한꺼번에 교체)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Client = { id: string; name: string; category: string | null; area: string | null; primary: string | null; support: string[] };
type Staff = { id: string; name: string; email: string; role: "owner" | "admin" | "staff" };
type Draft = { primary: string | null; support: string[] };

const ROLE: Record<string, string> = { owner: "오너", admin: "관리자", staff: "직원" };
const same = (a: Draft, b: Draft) => a.primary === b.primary && [...a.support].sort().join() === [...b.support].sort().join();

export default function AssignmentManager({ clients, staff }: { clients: Client[]; staff: Staff[] }) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");

  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? "(알 수 없음)";
  const draftOf = (c: Client): Draft => drafts[c.id] ?? { primary: c.primary, support: c.support };
  const update = (c: Client, d: Draft) => setDrafts((all) => ({ ...all, [c.id]: d }));

  const list = useMemo(() => clients.filter((c) => {
    if (q && !`${c.name} ${c.category ?? ""} ${c.area ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (who === "none") return !c.primary;
    if (who) return c.primary === who || c.support.includes(who);
    return true;
  }), [clients, q, who]);
  const unassigned = clients.filter((c) => !c.primary).length;

  async function save(c: Client) {
    const d = draftOf(c);
    if (!d.primary) { setMsg({ ok: false, text: `${c.name}: 주담당을 먼저 선택하세요.` }); return; }
    setBusy(c.id);
    const { error } = await sb.rpc("set_client_staff", { p_client: c.id, p_primary: d.primary, p_support: d.support });
    setBusy(null);
    if (error) { setMsg({ ok: false, text: `${c.name}: 담당 직원을 저장하지 못했습니다.` }); return; }
    setMsg({ ok: true, text: `${c.name}: 주담당 ${nameOf(d.primary)}${d.support.length ? `, 보조 ${d.support.map(nameOf).join(", ")}` : ""}(으)로 저장했습니다.` });
    setDrafts((all) => { const n = { ...all }; delete n[c.id]; return n; });
    router.refresh();
  }

  return (
    <>
      {msg && <div className={`${msg.ok ? "planned" : "notice"} mt`}>{msg.text}</div>}
      <div className="row mt">
        <input className="search" placeholder="광고주 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">전체 직원</option>
          <option value="none">주담당 없음 ({unassigned})</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name} 담당</option>)}
        </select>
        <span className="faint">광고주 {list.length}곳</span>
      </div>

      <section className="card mt">
        <div className="tbl-wrap"><table>
          <thead><tr><th>광고주</th><th>주담당</th><th>보조 담당</th><th></th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={4} className="faint">해당하는 광고주가 없습니다.</td></tr>}
            {list.map((c) => {
              const d = draftOf(c);
              const changed = !same(d, { primary: c.primary, support: c.support });
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/clients/${c.id}/settings`}><b>{c.name}</b></Link>
                    <div className="faint">{[c.category, c.area].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td>
                    <select value={d.primary ?? ""} disabled={busy === c.id}
                      onChange={(e) => { const p = e.target.value || null; update(c, { primary: p, support: d.support.filter((s) => s !== p) }); }}>
                      <option value="">— 선택 —</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({ROLE[s.role]})</option>)}
                    </select>
                    {!c.primary && <div><span className="badge warn">주담당 없음</span></div>}
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                      {d.support.map((s) => (
                        <span key={s} className="badge">{nameOf(s)}{" "}
                          <button type="button" className="link-x" aria-label={`${nameOf(s)} 제외`} disabled={busy === c.id}
                            onClick={() => update(c, { ...d, support: d.support.filter((x) => x !== s) })}>×</button>
                        </span>
                      ))}
                      <select value="" disabled={busy === c.id}
                        onChange={(e) => { const v = e.target.value; if (v) update(c, { ...d, support: [...d.support, v] }); }}>
                        <option value="">+ 보조 추가</option>
                        {staff.filter((s) => s.id !== d.primary && !d.support.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="r">
                    {changed && (
                      <span className="row">
                        <button className="btn sm" disabled={busy === c.id} onClick={() => setDrafts((all) => { const n = { ...all }; delete n[c.id]; return n; })}>취소</button>
                        <button className="btn primary sm" disabled={busy === c.id} onClick={() => save(c)}>{busy === c.id ? "저장 중…" : "저장"}</button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </section>
      <p className="faint mt">직원 계정 추가·권한 변경은 <Link href="/admin/staff">직원 · 권한 관리</Link>에서 합니다.</p>
    </>
  );
}
