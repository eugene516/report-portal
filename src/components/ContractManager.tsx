"use client";
// 월 계약 입력 화면: 계약 금액·기간·메모 + 항목별 수량·마감일 + 견적서·계약서 파일
// - 저장: save_month_contract (DB가 담당 여부·값을 다시 확인, 항목 일괄 교체)
// - 직접 입력 항목의 진행 수량: client_contract_items.done_count 만 수정 (DB가 그 칸만 허용)
import { ask, toast } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { SERVICES } from "./ServicePicker";
import { deleteQuote, uploadQuotes } from "./quotes";
import { applyQuote } from "@/app/admin/actions";

const AUTO = new Set(["blog", "cafe", "daangn", "cardnews", "column", "aeo"]);   // 리포트 자료로 진행 수량을 자동 집계
// 플레이스는 계약 수량 없이 고정 키워드로 매일 확인하므로 계약 항목에서 뺀다
const OPTIONS = [...SERVICES.filter((s) => s.id !== "place").map((s) => ({ id: s.id as string, label: s.label })), { id: "etc", label: "기타 업무" }];

type Row = { id?: string; service: string; label: string; quantity: string; dueOn: string; extra?: boolean; note?: string; doneCount?: number | null; autoDone?: number | null };
type Props = {
  clientId: string; inHouse?: boolean; period: string; monthLabel: string; lastDay: string; isCurrent: boolean;
  head: { amount: number | null; startsOn: string | null; endsOn: string | null; memo: string | null; updatedAt: string } | null;
  items: Row[];
  prevItems: { service: string; label: string; quantity: number; day: number }[];
  files: { id: string; storage_path: string; file_name: string; kind: string; size_bytes: number | null; created_at: string }[];
};

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

export default function ContractManager(p: Props) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<Row[]>(p.items);
  const [amount, setAmount] = useState(p.head?.amount != null ? String(p.head.amount) : "");
  const [startsOn, setStartsOn] = useState(p.head?.startsOn ?? `${p.period}-01`);
  const [endsOn, setEndsOn] = useState(p.head?.endsOn ?? p.lastDay);
  const [memo, setMemo] = useState(p.head?.memo ?? "");
  const [kind, setKind] = useState<"quote" | "contract">("quote");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  // 저장 결과는 화면 아래 알림으로
  const setMsg = (m: { ok: boolean; text: string } | null) => { if (m) toast(m.text, { kind: m.ok ? "ok" : "error" }); };
  const [done, setDone] = useState<Record<string, string>>(Object.fromEntries(p.items.filter((r) => r.id).map((r) => [r.id!, r.doneCount == null ? "" : String(r.doneCount)])));

  const finish = (ok: boolean, text: string) => { setMsg({ ok, text }); setBusy(false); if (ok) { setDirty(false); router.refresh(); } };
  const edit = (k: number, patch: Partial<Row>) => { setRows(rows.map((r, i) => (i === k ? { ...r, ...patch } : r))); setDirty(true); };
  const add = (extra = false) => { setRows([...rows, { service: "blog", label: "", quantity: "", dueOn: p.lastDay, extra, note: "" }]); setDirty(true); };
  const remove = (k: number) => { setRows(rows.filter((_, i) => i !== k)); setDirty(true); };
  async function copyPrev() {
    if (rows.length && !await ask(`지금 입력된 항목을 지난달 ${p.inHouse ? "업무" : "계약"} 항목으로 바꿀까요?`)) return;
    const [y, m] = p.period.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    setRows(p.prevItems.map((i) => ({ service: i.service, label: i.label, quantity: String(i.quantity), dueOn: `${p.period}-${String(Math.min(i.day, days)).padStart(2, "0")}` })));
    setDirty(true);
  }

  async function save() {
    for (const r of rows) {
      if (r.quantity === "" || !/^\d+$/.test(r.quantity)) return setMsg({ ok: false, text: "모든 항목의 수량을 숫자로 입력해 주세요." });
      if (!r.dueOn) return setMsg({ ok: false, text: "모든 항목의 마감일을 입력해 주세요." });
      if (r.service === "etc" && !r.label.trim()) return setMsg({ ok: false, text: "‘기타 업무’는 업무 이름을 입력해 주세요." });
    }
    if (startsOn && endsOn && startsOn > endsOn) return setMsg({ ok: false, text: "계약 시작일이 종료일보다 늦습니다." });
    const amt = amount.replace(/[^\d]/g, "");
    setBusy(true); setMsg(null);
    const { error } = await sb.rpc("save_month_contract", {
      p_client: p.clientId, p_period: p.period, p_amount: amt === "" ? null : Number(amt),
      p_starts: startsOn || null, p_ends: endsOn || null, p_memo: memo,
      p_items: rows.map((r) => ({ id: r.id, service: r.service, label: r.label.trim() || null, quantity: Number(r.quantity), dueOn: r.dueOn, extra: !!r.extra, note: r.note?.trim() || null })),
    });
    const what = p.inHouse ? "업무 항목" : "계약 내용";
    finish(!error, error ? `${what}을 저장하지 못했습니다. 입력값을 확인해 주세요.` : `${p.monthLabel} ${what}을 저장했습니다.${p.isCurrent ? ` 리포트 ${p.inHouse ? "" : "계약 "}항목(월 목표)에도 반영했습니다.` : ""}`);
  }

  async function saveDone(id: string) {
    const v = (done[id] ?? "").trim();
    if (v !== "" && !/^\d+$/.test(v)) return setMsg({ ok: false, text: "진행 수량은 숫자로 입력해 주세요." });
    setBusy(true);
    const { error } = await sb.from("client_contract_items").update({ done_count: v === "" ? null : Number(v) }).eq("id", id);
    finish(!error, error ? "진행 수량을 저장하지 못했습니다." : "진행 수량을 저장했습니다.");
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    const r = await uploadQuotes(sb, p.clientId, files, { period: p.period, kind });
    if (r.failed) setMsg({ ok: false, text: `파일 ${r.failed}개를 올리지 못했습니다 (형식·크기 확인).` });
    // 견적서는 내용을 읽어 이 달 계약에 바로 반영한다
    if (kind === "quote") for (const id of r.ids) { const a = await applyQuote(id); setMsg(a.ok ? { ok: true, text: a.ok } : { ok: false, text: a.error ?? "반영하지 못했습니다." }); }
    finish(r.ids.length > 0, `${kind === "quote" ? "견적서" : "계약서"}를 올렸습니다.`);
  }
  async function removeFile(f: { id: string; storage_path: string; file_name: string; kind: string }) {
    if (!(await ask(`‘${f.file_name}’ ${f.kind === "contract" ? "계약서" : "견적서"}를 삭제할까요?
광고주 화면에서도 사라집니다. 이미 계약에 반영한 내용은 그대로 남습니다.`))) return;
    setBusy(true);
    const ok = await deleteQuote(sb, f);
    setBusy(false);
    setMsg({ ok, text: ok ? "파일을 삭제했습니다." : "파일을 삭제하지 못했습니다." });
    if (ok) router.refresh();
  }
  async function openFile(path: string) {
    const { data } = await sb.storage.from("quotes").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  const total = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const extraTotal = rows.filter((r) => r.extra).reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  return (
    <>
      {!p.head && (p.inHouse
        ? <div className="notice mt">{p.monthLabel} 업무 항목이 아직 없습니다. ‘+ 항목 추가’로 진행할 업무를 등록하세요.</div>
        : <div className="notice mt">{p.monthLabel} 계약 내용이 아직 등록되지 않았습니다. 항목을 입력하거나 ‘지난달 계약 불러오기’로 시작하세요.</div>)}

      {!p.inHouse && <section className="card pad mt">
        <div className="card-h"><h2>{p.monthLabel} 계약 내용</h2>{p.head && <span className="faint">마지막 저장 {kst(p.head.updatedAt)}</span>}</div>
        <div className="key-form">
          <label>계약 금액 (원)<input className="search" inputMode="numeric" value={amount} placeholder="예: 1500000" onChange={(e) => { setAmount(e.target.value); setDirty(true); }} /></label>
          <label>계약 시작일<input className="search" type="date" value={startsOn} onChange={(e) => { setStartsOn(e.target.value); setDirty(true); }} /></label>
          <label>계약 종료일<input className="search" type="date" value={endsOn} onChange={(e) => { setEndsOn(e.target.value); setDirty(true); }} /></label>
        </div>
        <label className="memo-l mt">메모 (내부용 · 광고주 화면에는 보이지 않음)
          <textarea className="paste" rows={3} maxLength={2000} value={memo} onChange={(e) => { setMemo(e.target.value); setDirty(true); }} placeholder="특이사항, 추가 요청, 결제 조건 등" />
        </label>
      </section>}

      <section className="card pad mt">
        <div className="card-h">
          <h2>{p.inHouse ? "업무 항목" : "계약 항목"} · 마감일 <span className="faint">합계 {total}건{extraTotal ? ` (추가 ${extraTotal}건 포함)` : ""}</span></h2>
          <div className="row">
            {p.prevItems.length > 0 && <button className="btn sm" disabled={busy} onClick={copyPrev}>지난달 {p.inHouse ? "항목" : "계약"} 불러오기 ({p.prevItems.length}개)</button>}
            {p.inHouse ? <button className="btn sm primary" disabled={busy} onClick={() => add(false)}>+ 항목 추가</button> : <>
              <button className="btn sm" disabled={busy} onClick={() => add(false)}>+ 견적 항목</button>
              <button className="btn sm" disabled={busy} onClick={() => add(true)}>+ 추가 진행 업무</button>
            </>}
          </div>
        </div>
        <div className="tbl-wrap"><table className="contract-table rtable">
          <thead><tr>{!p.inHouse && <th>구분</th>}<th>업무</th><th>세부 내용</th><th className="r">수량</th><th>마감일</th><th>진행 수량</th><th>{p.inHouse ? "메모" : "추가 사유 · 메모"}</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={p.inHouse ? 7 : 8} className="faint">항목이 없습니다. {p.inHouse ? "‘+ 항목 추가’를" : "‘+ 견적 항목’ 또는 ‘+ 추가 진행 업무’를"} 눌러 주세요.</td></tr>}
            {rows.map((r, k) => (
              <tr key={r.id ?? `new-${k}`} className={r.extra ? "row-extra" : ""}>
                {!p.inHouse && <td data-label="구분"><select value={r.extra ? "extra" : "base"} onChange={(e) => edit(k, { extra: e.target.value === "extra" })} aria-label="구분"><option value="base">견적</option><option value="extra">추가</option></select></td>}
                <td data-label="업무"><select value={r.service} onChange={(e) => edit(k, { service: e.target.value })}>{OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></td>
                <td data-label="세부 내용"><input className="search" value={r.label} maxLength={60} placeholder={r.service === "etc" ? "업무 이름 (필수)" : "예: 상위노출 키워드형"} onChange={(e) => edit(k, { label: e.target.value })} /></td>
                <td className="r" data-label="수량"><input className="search num-in" inputMode="numeric" value={r.quantity} onChange={(e) => edit(k, { quantity: e.target.value.replace(/[^\d]/g, "") })} /></td>
                <td data-label="마감일"><input className="search date" type="date" value={r.dueOn} min={`${p.period}-01`} onChange={(e) => edit(k, { dueOn: e.target.value })} /></td>
                <td data-label="진행 수량">
                  {!r.id ? <span className="faint">저장 후 표시</span>
                    : AUTO.has(r.service) ? <span title="리포트에 등록된 자료로 자동 집계"><b className="num">{r.autoDone ?? 0}</b><span className="faint"> / {r.quantity} · 자동</span></span>
                    : <span className="row nowrap">
                        <input className="search num-in" inputMode="numeric" value={done[r.id] ?? ""} placeholder="0" onChange={(e) => setDone({ ...done, [r.id!]: e.target.value })} />
                        <button className="btn sm" disabled={busy} onClick={() => saveDone(r.id!)}>저장</button>
                      </span>}
                </td>
                <td data-label={p.inHouse ? "메모" : "추가 사유 · 메모"}><input className="search" value={r.note ?? ""} maxLength={300} placeholder={r.extra ? "예: 10/15 추가 요청" : ""} onChange={(e) => edit(k, { note: e.target.value })} /></td>
                <td className="r"><button className="link-x" aria-label="항목 삭제" title="항목 삭제" onClick={() => remove(k)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="faint mt-s">{p.inHouse ? "블로그·카페·당근 바이럴·카드뉴스·칼럼·AEO는 리포트에 등록된 자료로 진행 수량이 자동 집계됩니다. 리뷰·기타 업무는 진행 수량을 직접 입력하세요." : <>‘추가’는 견적서 확정 내용과 별개로 중간에 추가된 업무입니다. 블로그·카페·당근 바이럴·카드뉴스·칼럼·AEO는 리포트에 등록된 자료로 진행 수량이 자동 집계됩니다. 플레이스·리뷰·기타 업무는 진행 수량을 직접 입력하세요.</>}</p>
        <div className="row mt">
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? "저장 중…" : p.inHouse ? "업무 항목 저장" : "계약 내용 저장"}</button>
          {dirty && <span className="faint">저장하지 않은 변경이 있습니다</span>}
        </div>
      </section>

      {!p.inHouse && <section className="card pad mt">
        <div className="card-h"><h2>{p.monthLabel} 견적서 · 계약서</h2>
          <div className="row">
            <select value={kind} onChange={(e) => setKind(e.target.value as "quote" | "contract")} aria-label="파일 종류"><option value="quote">견적서</option><option value="contract">계약서</option></select>
            <label className="btn sm">파일 선택<input type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.hwp" disabled={busy} onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} /></label>
          </div>
        </div>
        <ul className="list">
          {p.files.length === 0 && <li className="faint">이 달에 올린 파일이 없습니다. (PDF·이미지·엑셀·워드·한글, 20MB 이하)</li>}
          {p.files.map((f) => (
            <li key={f.id}>
              <span><span className={`badge ${f.kind === "contract" ? "acc" : ""}`}>{f.kind === "contract" ? "계약서" : "견적서"}</span> {f.file_name} <span className="faint">{kst(f.created_at)}</span></span>
              <span className="row">
                {f.kind !== "contract" && <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); const a = await applyQuote(f.id); finish(!!a.ok, a.ok ?? a.error ?? ""); }} title="견적서 내용을 읽어 이 달 계약 · 미집행 · 광고 채널을 다시 맞춥니다">계약에 반영</button>}
                <button className="btn sm" onClick={() => openFile(f.storage_path)}>열기</button>
                <button className="btn sm ghost" disabled={busy} onClick={() => removeFile(f)}>삭제</button>
              </span>
            </li>
          ))}
        </ul>
      </section>}
    </>
  );
}
