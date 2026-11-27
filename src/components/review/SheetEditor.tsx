"use client";
// 주제 · 키워드 엑셀 보기 + 화면에서 바로 수정
// - '✎ 주제 수정'을 누르면 표의 칸마다 입력칸이 열린다 (수식 칸 · 병합으로 가려진 칸은 그대로)
// - 저장하면 고친 칸이 노란 칸 + 빨간 글씨로 표시된 엑셀 파일이 된다 → '내려받기'로 고친 파일을 받는다
// - 저장은 review-edit 함수가 권한(직원: 언제나 · 광고주: 검수 대기 중)을 확인한 뒤 새 파일로 바꾼다. 처음 원본은 따로 보관
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ask, toast, toastError } from "@/components/ui";
import { EditedNote, type EditableFile } from "./DocxEditor";
import { EDIT_FILL, EDIT_FONT, sheetData, SheetView, type Sheet } from "./ReviewFiles";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const dlUrl = (url: string, name: string) => `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;

export default function SheetEditable({ f, canEdit }: { f: EditableFile; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  if (!f.url) return <p className="faint pad">파일 주소를 만들지 못했습니다.</p>;
  const xlsx = /\.xlsx$/i.test(f.name);   // CSV 는 보기만
  return (
    <div className="rv-docx">
      <div className={`rv-docx-bar ${editing ? "" : "stick"}`}>
        <EditedNote f={f} />
        {!editing && <span className="row rv-sheet-act">
          <a className="btn sm" href={dlUrl(f.url, f.name)}>{f.editCount ? "수정된 파일 내려받기" : "내려받기"}</a>
          {canEdit && xlsx && <button type="button" className="btn sm primary" onClick={() => setEditing(true)}>✎ 주제 수정</button>}
        </span>}
      </div>
      {editing ? <SheetEditor key={f.url} f={f} onClose={() => setEditing(false)} /> : <SheetView url={f.url} name={f.name} />}
    </div>
  );
}

const key = (sheet: string, r: number, c: number) => `${sheet}\u0000${r}\u0000${c}`;

function SheetEditor({ f, onClose }: { f: EditableFile; onClose: () => void }) {
  const router = useRouter();
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [err, setErr] = useState(false);
  const [vals, setVals] = useState<Map<string, string>>(new Map());   // 고친 칸만 (원래 글과 같아지면 뺀다)
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    sheetData(f.url!, f.name).then((s) => { if (alive) setSheets(s); }, () => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [f.url, f.name]);

  const set = (k: string, orig: string, v: string) => setVals((m) => { const n = new Map(m); if (v === orig) n.delete(k); else n.set(k, v); return n; });

  async function cancel() {
    if (vals.size && !(await ask(`고친 칸 ${vals.size}개가 저장되지 않았습니다. 수정을 취소할까요?`))) return;
    onClose();
  }
  async function save() {
    if (busy || !vals.size) return;
    setBusy(true);
    try {
      const buf = await (await fetch(f.url!)).arrayBuffer();
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      for (const [k, v] of vals) {
        const [sheet, r, c] = k.split("\u0000");
        const ws = wb.getWorksheet(sheet);
        if (!ws) continue;
        const cell = ws.getRow(Number(r)).getCell(Number(c));
        if (cell.type === ExcelJS.ValueType.Formula) continue;
        const wasNum = typeof cell.value === "number";
        cell.value = wasNum && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : v;
        // 칸마다 새 스타일 (같은 스타일을 쓰는 다른 칸까지 칠해지지 않게)
        const st = cell.style ?? {};
        cell.style = { ...st, font: { ...(st.font ?? {}), color: { argb: EDIT_FONT } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: EDIT_FILL } },
                       alignment: { ...(st.alignment ?? {}), wrapText: st.alignment?.wrapText ?? v.includes("\n") } };
      }
      const out = new Blob([await wb.xlsx.writeBuffer()], { type: XLSX });
      if (out.size > 30 * 1024 * 1024) { setBusy(false); return toastError("저장할 파일이 30MB를 넘습니다."); }
      const form = new FormData();
      form.append("fileId", f.id);
      form.append("file", new File([out], f.name, { type: XLSX }));
      const { error } = await supabaseBrowser().functions.invoke("review-edit", { body: form });
      if (error) {
        let msg = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        try { const j = await (error as { context?: Response }).context?.json(); if (j?.error && j.error !== "forbidden") msg = j.error; else if (j?.error) msg = "이 파일을 수정할 권한이 없습니다."; } catch { /* 기본 안내 */ }
        setBusy(false);
        return toastError(msg);
      }
      toast("저장했습니다. 고친 칸은 노란 칸 + 빨간 글씨로 표시되고, ‘수정된 파일 내려받기’로 받을 수 있습니다.");
      onClose();
      router.refresh();
    } catch {
      setBusy(false);
      toastError("엑셀 파일로 만들지 못했습니다.");
    }
  }

  if (err) return <div className="notice">이 파일은 화면에서 수정할 수 없습니다. 파일을 내려받아 수정해 주세요.</div>;
  if (!sheets) return <div className="faint pad-x">엑셀 불러오는 중…</div>;
  return (
    <div className="rv-editor">
      <div className="rv-editor-bar">
        <b>주제 수정 중</b>
        <span className="faint">{vals.size ? `고친 칸 ${vals.size}개` : "고칠 칸을 눌러 바로 입력하세요 (수식 칸은 회색)"}</span>
        <span className="rv-editor-act">
          <button type="button" className="btn sm" disabled={busy} onClick={cancel}>취소</button>
          <button type="button" className="btn sm primary" disabled={busy || !vals.size} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
        </span>
      </div>
      <div className="sheet-view sheet-edit">
        {sheets.filter((s) => s.rows.length).map((s) => (
          <section key={s.name}>
            {sheets.length > 1 && <h4>{s.name}</h4>}
            <div className="table-wrap"><table style={{ width: "100%", minWidth: Math.min(900, s.cols.reduce((a, b) => a + b, 0)) }}>
              <colgroup>{s.cols.map((w, i) => <col key={i} style={i === s.cols.indexOf(Math.max(...s.cols)) ? undefined : { width: w }} />)}</colgroup>
              <tbody>
                {s.rows.map((r, i) => <tr key={i}>{r.map((c, j) => {
                  if (!c) return null;
                  if (!c.at || c.fx) return <td key={j} colSpan={c.cs} rowSpan={c.rs} className={`${c.b ? "b" : ""} locked`}>{c.v}</td>;
                  const k = key(s.name, c.at[0], c.at[1]);
                  const v = vals.get(k) ?? c.v;
                  return <td key={j} colSpan={c.cs} rowSpan={c.rs} className={`${c.b ? "b" : ""} ${vals.has(k) ? "dirty" : c.e ? "sh-edit" : ""}`}><CellBox value={v} onChange={(nv) => set(k, c.v, nv)} /></td>;
                })}</tr>)}
              </tbody>
            </table></div>
          </section>
        ))}
      </div>
    </div>
  );
}

// 칸 입력: 글 길이에 맞춰 높이가 늘어난다
function CellBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} className="sh-cell" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label="칸 내용" />;
}
