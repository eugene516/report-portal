"use client";
// 검수 콘텐츠 파일 보기: Word(.docx)는 페이지 안에서 바로 미리보기, 이미지는 갤러리, 모든 파일 내려받기
// 파일 주소는 서버가 로그인 세션으로 만든 30분짜리 서명 주소 (비공개 저장소)
import { useEffect, useState } from "react";
import type { ReviewFile } from "@/lib/review";

const isImage = (f: ReviewFile) => /^image\//.test(f.mime_type ?? "") || /\.(png|jpe?g|webp|gif)$/i.test(f.file_name);
const isDocx = (f: ReviewFile) => /\.docx$/i.test(f.file_name) || f.mime_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const size = (n: number | null) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const dl = (f: ReviewFile) => (f.url ? `${f.url}${f.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(f.file_name)}` : undefined);

function DocxPreview({ f }: { f: ReviewFile }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const buf = await (await fetch(f.url!)).arrayBuffer();
        const mammoth = await import("mammoth");
        const r = await mammoth.convertToHtml({ arrayBuffer: buf });
        // 원고에서 만든 HTML 이라도 스크립트 · 이벤트 속성은 걷어낸다
        const doc = new DOMParser().parseFromString(r.value, "text/html");
        doc.querySelectorAll("script, iframe, object, embed, style").forEach((n) => n.remove());
        doc.querySelectorAll("*").forEach((n) => { for (const a of [...n.attributes]) if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name); });
        if (alive) setHtml(doc.body.innerHTML);
      } catch { if (alive) setErr(true); }
    })();
    return () => { alive = false; };
  }, [f.url]);
  if (err) return <div className="notice">미리보기를 만들지 못했습니다. 파일을 내려받아 확인해 주세요.</div>;
  if (html === null) return <div className="faint pad-x">원고 불러오는 중…</div>;
  return <article className="docx-view" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function ReviewFiles({ files }: { files: ReviewFile[] }) {
  const docs = files.filter(isDocx);
  const images = files.filter(isImage);
  const others = files.filter((f) => !isDocx(f) && !isImage(f));
  return (
    <div className="review-files">
      {docs.map((f) => (
        <section key={f.id} className="card pad">
          <div className="card-h"><h3>📄 {f.file_name}</h3><a className="btn sm" href={dl(f)}>내려받기</a></div>
          {f.url ? <DocxPreview f={f} /> : <p className="faint">파일 주소를 만들지 못했습니다.</p>}
        </section>
      ))}
      {images.length > 0 && (
        <section className="card pad">
          <div className="card-h"><h3>🖼 이미지 {images.length}장</h3></div>
          <div className="review-gallery">
            {images.map((f) => (
              <figure key={f.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <a href={f.url ?? undefined} target="_blank" rel="noopener noreferrer"><img src={f.url ?? undefined} alt={f.file_name} loading="lazy" /></a>
                <figcaption><span>{f.file_name}</span><a href={dl(f)}>내려받기</a></figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      {others.length > 0 && (
        <section className="card pad">
          <h3>첨부 파일</h3>
          <ul className="list">{others.map((f) => <li key={f.id}><span>{f.file_name} <span className="faint">{size(f.size_bytes)}</span></span><a className="btn sm" href={dl(f)}>내려받기</a></li>)}</ul>
        </section>
      )}
      {files.length === 0 && <div className="empty-state">첨부 파일이 없습니다.</div>}
    </div>
  );
}
