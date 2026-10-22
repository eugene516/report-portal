"use client";
// 검수 콘텐츠 파일 보기: 모든 파일을 썸네일로 정리 → 썸네일을 누르면 전체 내용 보기 (Word 원고 · 이미지 · PDF), 내려받기
// 파일 주소는 서버가 로그인 세션으로 만든 30분짜리 서명 주소 (비공개 저장소). 등록 전 선택한 파일은 브라우저 안 주소(blob:)
import { useEffect, useState } from "react";
import type { ReviewFile } from "@/lib/review";

export type ThumbFile = { id: string; name: string; url: string | null; mime: string | null; size: number | null; download?: string };

export const isImage = (f: ThumbFile) => /^image\//.test(f.mime ?? "") || /\.(png|jpe?g|webp|gif)$/i.test(f.name);
export const isDocx = (f: ThumbFile) => /\.docx$/i.test(f.name) || f.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
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
                : isPdf(cur) ? <iframe src={cur.url} title={cur.name} />
                : <div className="notice">이 형식은 화면에서 바로 볼 수 없습니다. {cur.download ? "내려받아 확인해 주세요." : "등록한 뒤 내려받아 확인할 수 있습니다."}</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ReviewFiles({ files }: { files: ReviewFile[] }) {
  if (files.length === 0) return <div className="empty-state">첨부 파일이 없습니다.</div>;
  return (
    <section className="card pad review-files">
      <div className="card-h"><h3>파일 {files.length}개</h3><span className="faint">썸네일을 누르면 전체 내용을 볼 수 있습니다</span></div>
      <FileThumbs files={files.map((f) => ({ id: f.id, name: f.file_name, url: f.url ?? null, mime: f.mime_type, size: f.size_bytes, download: dl(f) }))} />
    </section>
  );
}
