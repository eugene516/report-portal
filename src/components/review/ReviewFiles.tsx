"use client";
// 검수 콘텐츠 파일 보기: 모든 파일을 썸네일로 정리 → 썸네일을 누르면 전체 내용 보기 (Word 원고 · 엑셀 · 이미지 · PDF), 내려받기
// 파일 주소는 서버가 로그인 세션으로 만든 30분짜리 서명 주소 (비공개 저장소). 등록 전 선택한 파일은 브라우저 안 주소(blob:)
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ask, toast, toastError } from "@/components/ui";
import type { ReviewFile } from "@/lib/review";

export type ThumbFile = { id: string; name: string; url: string | null; mime: string | null; size: number | null; download?: string };

export const isImage = (f: ThumbFile) => /^image\//.test(f.mime ?? "") || /\.(png|jpe?g|webp|gif)$/i.test(f.name);
export const isDocx = (f: ThumbFile) => /\.docx$/i.test(f.name) || f.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const isSheet = (f: ThumbFile) => /\.(xlsx|csv)$/i.test(f.name);
export const isPdf = (f: ThumbFile) => /\.pdf$/i.test(f.name) || f.mime === "application/pdf";
const size = (n: number | null) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const ext = (name: string) => (name.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? "파일").toUpperCase();
const dl = (f: ReviewFile) => (f.url ? `${f.url}${f.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(f.file_name)}` : undefined);

// Word 원고 → HTML (썸네일 · 전체 보기가 같은 결과를 쓰도록 주소별로 한 번만 변환)
const docxCache = new Map<string, Promise<string>>();
function docxHtml(url: string) {
  let p = docxCache.get(url);
  if (!p) {
    p = (async () => {
      const buf = await (await fetch(url)).arrayBuffer();
      const mammoth = await import("mammoth");
      const r = await mammoth.convertToHtml({ arrayBuffer: buf });
      // 원고에서 만든 HTML 이라도 스크립트 · 이벤트 속성은 걷어낸다
      const doc = new DOMParser().parseFromString(r.value, "text/html");
      doc.querySelectorAll("script, iframe, object, embed, style").forEach((n) => n.remove());
      doc.querySelectorAll("*").forEach((n) => { for (const a of [...n.attributes]) if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name); });
      return doc.body.innerHTML;
    })();
    p.catch(() => docxCache.delete(url));
    docxCache.set(url, p);
  }
  return p;
}

function useDocx(url: string) {
  const [state, setState] = useState<{ url: string; html: string | null; err: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    docxHtml(url).then((html) => { if (alive) setState({ url, html, err: false }); }, () => { if (alive) setState({ url, html: null, err: true }); });
    return () => { alive = false; };
  }, [url]);
  return state?.url === url ? state : { url, html: null, err: false };
}

export function DocxView({ url, thumb }: { url: string; thumb?: boolean }) {
  const { html, err } = useDocx(url);
  if (err) return thumb ? <span className="thumb-icon">DOCX</span> : <div className="notice">미리보기를 만들지 못했습니다. 파일을 내려받아 확인해 주세요.</div>;
  if (html === null) return thumb ? <span className="thumb-icon faint">불러오는 중…</span> : <div className="faint pad-x">원고 불러오는 중…</div>;
  return <article className={thumb ? "docx-thumb" : "docx-view"} dangerouslySetInnerHTML={{ __html: html }} />;
}

// 엑셀(xlsx) · CSV → 시트별 표 (값 · 굵게 · 병합 · 열 너비만). 글자는 React 가 그대로 이스케이프한다
// - 병합된 셀은 한 칸으로 합쳐 그린다 (제목 · 안내 줄이 열마다 반복되지 않도록)
// - 열 너비는 엑셀 열 너비를 따르고, 긴 글은 칸 안에서 줄바꿈한다
type SheetCell = { v: string; cs?: number; rs?: number; b?: boolean };
type Sheet = { name: string; cols: number[]; rows: (SheetCell | null)[][] };   // null = 병합으로 가려진 칸
const sheetCache = new Map<string, Promise<Sheet[]>>();
const MAX_ROWS = 500;
const colPx = (w: number | undefined) => Math.round(Math.min(420, Math.max(48, (w ?? 10) * 7.5)));
function sheetData(url: string, name: string) {
  let p = sheetCache.get(url);
  if (!p) {
    p = (async () => {
      const buf = await (await fetch(url)).arrayBuffer();
      if (/\.csv$/i.test(name)) {
        // 한국어 엑셀이 저장한 CSV 는 EUC-KR 인 경우가 많다: UTF-8 로 안 읽히면 EUC-KR 로 다시 읽는다
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("euc-kr").decode(buf); }
        const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim()).slice(0, MAX_ROWS)
          .map((l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, "\"")).slice(0, -1));
        const width = Math.max(0, ...rows.map((r) => r.length));
        return [{ name: "CSV", cols: Array.from({ length: width }, () => colPx(14)), rows: rows.map((r, i) => r.map((v) => ({ v, b: i === 0 }))) }];
      }
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      return wb.worksheets.map((ws) => {
        // 병합: "A1:F1" → 시작 칸에 colSpan · rowSpan, 나머지 칸은 건너뜀
        const span = new Map<string, { cs: number; rs: number }>();
        const hidden = new Set<string>();
        for (const m of (ws.model as { merges?: string[] }).merges ?? []) {
          const [a, b] = m.split(":").map((x) => ws.getCell(x));
          if (!a || !b) continue;
          const [r1, c1, r2, c2] = [Number(a.row), Number(a.col), Number(b.row), Number(b.col)];
          span.set(`${r1}:${c1}`, { cs: c2 - c1 + 1, rs: r2 - r1 + 1 });
          for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) hidden.add(`${r}:${c}`);
        }
        // 내용이 있는 마지막 열까지만
        let last = 0;
        ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell, c) => { if (String(cell.text ?? "").trim() && !hidden.has(`${row.number}:${c}`)) last = Math.max(last, c + (span.get(`${row.number}:${c}`)?.cs ?? 1) - 1); }));
        const rows: (SheetCell | null)[][] = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          if (rows.length >= MAX_ROWS) return;
          const cells: (SheetCell | null)[] = [];
          for (let c = 1; c <= last; c++) {
            const key = `${row.number}:${c}`;
            if (hidden.has(key)) { cells.push(null); continue; }
            const cell = row.getCell(c);
            const sp = span.get(key);
            cells.push({ v: String(cell.text ?? ""), cs: sp ? Math.min(sp.cs, last - c + 1) : undefined, rs: sp?.rs, b: !!cell.font?.bold });
          }
          // 글자가 한 칸뿐인 줄(제목 · 안내 문구): 엑셀에서 옆 빈칸으로 넘쳐 보이던 것처럼 줄 끝까지 한 칸으로
          const filled = cells.filter((x) => x?.v.trim());
          if (filled.length === 1 && !filled[0]!.cs) {
            const i = cells.indexOf(filled[0]);
            if (cells.slice(i + 1).every((x) => x && !x.v.trim())) { filled[0]!.cs = cells.length - i; for (let k = i + 1; k < cells.length; k++) cells[k] = null; }
          }
          if (filled.length) rows.push(cells);
        });
        // 열 너비: 엑셀 열 너비와 그 열의 가장 긴 글(한 칸짜리 줄 제외, 한 줄 기준) 중 좁은 쪽 → 글보다 넓게 잡힌 칸을 줄인다
        const textPx = (t: string) => [...t].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 13.5 : 7.5), 0);   // 한글 · 한자는 넓게
        const longest = Array.from({ length: last }, (_, i) => Math.max(0, ...rows.map((r) => (r[i] && !r[i]!.cs ? Math.max(0, ...r[i]!.v.split(/\r?\n/).map(textPx)) : 0))));
        return { name: ws.name, cols: Array.from({ length: last }, (_, i) => Math.min(colPx(ws.getColumn(i + 1).width), Math.max(48, Math.round(longest[i] + 22)))), rows };
      });
    })();
    p.catch(() => sheetCache.delete(url));
    sheetCache.set(url, p);
  }
  return p;
}

export function SheetView({ url, name }: { url: string; name: string }) {
  const [state, setState] = useState<{ url: string; sheets: Sheet[] | null; err: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    sheetData(url, name).then((sheets) => { if (alive) setState({ url, sheets, err: false }); }, () => { if (alive) setState({ url, sheets: null, err: true }); });
    return () => { alive = false; };
  }, [url, name]);
  const cur = state?.url === url ? state : null;
  if (cur?.err) return <div className="notice">미리보기를 만들지 못했습니다. 파일을 내려받아 확인해 주세요.</div>;
  if (!cur?.sheets) return <div className="faint pad-x">엑셀 불러오는 중…</div>;
  return (
    <div className="sheet-view">
      {cur.sheets.filter((s) => s.rows.length).map((s) => (
        <section key={s.name}>
          {cur.sheets!.length > 1 && <h4>{s.name}</h4>}
          {/* 화면 폭에 맞춰 열 비율대로 줄이고, 너무 좁으면(엑셀 너비 합 또는 900px 중 작은 값) 가로로 넘긴다 */}
          <div className="table-wrap"><table style={{ width: "100%", minWidth: Math.min(900, s.cols.reduce((a, b) => a + b, 0)) }}>
            {/* 남는 폭은 가장 넓은 열(보통 제목)만 받는다 → 키워드 같은 짧은 열이 같이 늘어나지 않게 */}
            <colgroup>{s.cols.map((w, i) => <col key={i} style={i === s.cols.indexOf(Math.max(...s.cols)) ? undefined : { width: w }} />)}</colgroup>
            <tbody>
              {s.rows.map((r, i) => <tr key={i}>{r.map((c, j) => c && <td key={j} colSpan={c.cs} rowSpan={c.rs} className={c.b ? "b" : undefined}>{c.v}</td>)}</tr>)}
            </tbody>
          </table></div>
          {s.rows.length >= MAX_ROWS && <p className="faint">처음 {MAX_ROWS}줄만 보입니다. 전체는 내려받아 확인해 주세요.</p>}
        </section>
      ))}
    </div>
  );
}

function Thumb({ f }: { f: ThumbFile }) {
  if (!f.url) return <span className="thumb-icon">{ext(f.name)}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  if (isImage(f)) return <img src={f.url} alt={f.name} loading="lazy" />;
  if (isDocx(f)) return <DocxView url={f.url} thumb />;
  return <span className="thumb-icon">{ext(f.name)}</span>;
}

// 썸네일 목록 + 전체 보기 창 (← → 로 다음 파일, Esc 로 닫기)
export function FileThumbs({ files, onRemove }: { files: ThumbFile[]; onRemove?: (id: string) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const idx = open == null ? null : Math.min(open, files.length - 1);
  const cur = idx == null || idx < 0 ? null : files[idx];
  const last = files.length - 1;
  useEffect(() => {
    if (!cur) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i == null ? i : Math.min(last, i + 1)));
      if (e.key === "ArrowLeft") setOpen((i) => (i == null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = ""; };
  }, [cur, last]);
  if (files.length === 0) return null;
  return (
    <>
      <ul className="file-thumbs">
        {files.map((f, i) => (
          <li key={f.id}>
            <button type="button" className={`fthumb ${isDocx(f) ? "doc" : ""}`} onClick={() => setOpen(i)} title={`${f.name} 전체 보기`}><Thumb f={f} /></button>
            <div className="thumb-cap">
              <span className="thumb-name" title={f.name}>{f.name}</span>
              <span className="faint">{size(f.size)}</span>
              {onRemove && <button type="button" className="thumb-x" onClick={() => onRemove(f.id)} aria-label={`${f.name} 빼기`}>✕</button>}
            </div>
          </li>
        ))}
      </ul>
      {cur && idx != null && (
        <div className="modal file-viewer" role="dialog" aria-modal="true" aria-label={cur.name}>
          <div className="modal-backdrop" onClick={() => setOpen(null)} />
          <div className="modal-panel">
            <button type="button" className="modal-x" onClick={() => setOpen(null)} aria-label="닫기">×</button>
            <div className="fv-head">
              <b className="fv-name">{cur.name}</b>
              <span className="faint">{idx + 1} / {files.length}</span>
              <span className="fv-nav">
                <button type="button" className="btn sm" disabled={idx === 0} onClick={() => setOpen(idx - 1)}>‹ 이전</button>
                <button type="button" className="btn sm" disabled={idx === last} onClick={() => setOpen(idx + 1)}>다음 ›</button>
                {cur.download && <a className="btn sm" href={cur.download}>내려받기</a>}
              </span>
            </div>
            <div className="fv-body">
              {!cur.url ? <p className="faint">파일 주소를 만들지 못했습니다.</p>
                // eslint-disable-next-line @next/next/no-img-element
                : isImage(cur) ? <img src={cur.url} alt={cur.name} />
                : isDocx(cur) ? <DocxView url={cur.url} />
                : isSheet(cur) ? <SheetView url={cur.url} name={cur.name} />
                : isPdf(cur) ? <iframe src={cur.url} title={cur.name} />
                : <div className="notice">이 형식은 화면에서 바로 볼 수 없습니다. {cur.download ? "내려받아 확인해 주세요." : "등록한 뒤 내려받아 확인할 수 있습니다."}</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// removable: 담당 직원이 지금 버전 · 다음 수정본 파일을 지울 수 있다 (기록을 먼저 지우고 저장소 파일을 지운다)
export default function ReviewFiles({ files, removable = false }: { files: ReviewFile[]; removable?: boolean }) {
  const router = useRouter();
  async function remove(id: string) {
    const f = files.find((x) => x.id === id);
    if (!f || !await ask(`‘${f.file_name}’ 파일을 삭제할까요?
삭제한 뒤 새 파일을 다시 올릴 수 있습니다.`)) return;
    const sb = supabaseBrowser();
    const { data, error } = await sb.from("review_files").delete().eq("id", id).select("id");
    if (error || !data?.length) return toastError("파일을 삭제하지 못했습니다.");
    await sb.storage.from("reviews").remove([f.storage_path]);
    toast("파일을 삭제했습니다."); router.refresh();
  }
  if (files.length === 0) return <div className="empty-state">첨부 파일이 없습니다.</div>;
  return (
    <section className="card pad review-files">
      <div className="card-h"><h3>파일 {files.length}개</h3><span className="faint">썸네일을 누르면 전체 내용을 볼 수 있습니다</span></div>
      <FileThumbs files={files.map((f) => ({ id: f.id, name: f.file_name, url: f.url ?? null, mime: f.mime_type, size: f.size_bytes, download: dl(f) }))} onRemove={removable ? remove : undefined} />
    </section>
  );
}
