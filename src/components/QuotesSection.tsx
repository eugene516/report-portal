// 광고주 화면 '견적서' 메뉴: 등록된 견적서 · 계약서 목록과 열람 (서버 컴포넌트)
// 파일 주소: 직원(미리보기) = 로그인 세션 서명 주소, 광고주 링크 = report-quote 함수(토큰 확인 후 서명 주소로 이동)
import type { ReportCtx } from "@/lib/report";
import { supabaseForClientLink, supabaseForStaff } from "@/lib/supabase/server";

type Quote = { id: string; period: string | null; kind: string; fileName: string; size: number | null; createdAt: string; url: string | null };

const KIND: Record<string, string> = { quote: "견적서", contract: "계약서" };
const size = (n: number | null) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const day = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);

async function getQuotes(ctx: ReportCtx): Promise<Quote[]> {
  if (ctx.mode === "client") {
    const { data } = await supabaseForClientLink().rpc("report_quotes", { p_token: ctx.token });
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/report-quote`;
    return ((data ?? []) as Omit<Quote, "url">[]).map((q) => ({ ...q, url: `${base}?t=${encodeURIComponent(ctx.token)}&id=${q.id}` }));
  }
  const db = await supabaseForStaff();
  const { data } = await db.from("client_quotes").select("id, period, kind, file_name, size_bytes, created_at, storage_path").eq("client_id", ctx.clientId)
    .order("period", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  const rows = data ?? [];
  const { data: signed } = rows.length ? await db.storage.from("quotes").createSignedUrls(rows.map((r) => r.storage_path), 600) : { data: [] };
  const url = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({ id: r.id, period: r.period, kind: r.kind, fileName: r.file_name, size: r.size_bytes, createdAt: r.created_at, url: url.get(r.storage_path) ?? null }));
}

export default async function QuotesSection({ ctx }: { ctx: ReportCtx }) {
  const list = await getQuotes(ctx);
  return (
    <>
      <p className="muted">믿는구석이 등록한 월별 견적서 · 계약서입니다. ‘보기’를 누르면 새 창에서 열립니다.</p>
      <div className="card tbl-wrap"><table>
        <thead><tr><th>No</th><th>대상 월</th><th>종류</th><th>파일</th><th>등록일</th><th></th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={6} className="faint">등록된 견적서가 없습니다.</td></tr>}
          {list.map((q, i) => (
            <tr key={q.id}>
              <td className="faint num">{i + 1}</td>
              <td className="num">{q.period ? `${q.period.replace("-", "년 ")}월` : "-"}</td>
              <td><span className="badge">{KIND[q.kind] ?? q.kind}</span></td>
              <td className="ellipsis"><b>{q.fileName}</b> <span className="faint">{size(q.size)}</span></td>
              <td className="faint num">{day(q.createdAt)}</td>
              <td className="r">{q.url && <a className="btn sm" href={q.url} target="_blank" rel="noopener noreferrer">보기</a>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
