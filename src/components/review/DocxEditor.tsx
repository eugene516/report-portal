"use client";
// Word 원고 보기 + 화면에서 바로 수정 (블로그 · 홈페이지 칼럼)
// - '✎ 원고 수정'을 누르면 문단마다 입력칸이 열리고, 저장하면 고친 글자만 노란 형광 + 빨간 글씨로 표시된 Word 파일이 된다
// - 저장은 review-edit 함수가 권한(직원: 검수 완료 전 · 광고주: 검수 대기 중)을 확인한 뒤 새 파일로 바꾼다. 처음 원본은 따로 보관
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ask, toast, toastError } from "@/components/ui";
import { DocxView } from "./ReviewFiles";

const kst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ").replace("-", "/");

export type EditableFile = { id: string; name: string; url: string | null; editedAt?: string | null; editedBy?: string | null; editCount?: number; originalUrl?: string | null };

// 수정 이력 한 줄 (몇 번 · 누가 · 언제, 원본 내려받기)
export function EditedNote({ f }: { f: EditableFile }) {
  if (!f.editCount || !f.editedAt) return null;
  return (
    <div className="rv-edited">
      <mark className="rv-edit">수정됨</mark>
      <span>{f.editCount}회 · 마지막 {f.editedBy ?? ""} {kst(f.editedAt)}</span>
      <span className="faint">형광 + 빨간 글씨가 고친 부분입니다</span>
      {f.originalUrl && <a href={`${f.originalUrl}${f.originalUrl.includes("?") ? "&" : "?"}download=${encodeURIComponent(f.name.replace(/\.docx$/i, "") + "_원본.docx")}`}>원본 내려받기</a>}
    </div>
  );
}

export default function DocxEditable({ f, canEdit }: { f: EditableFile; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  if (!f.url) return <p className="faint pad">파일 주소를 만들지 못했습니다.</p>;
  return (
    <div className="rv-docx">
      {(canEdit || !!f.editCount) && (
        <div className="rv-docx-bar">
          <EditedNote f={f} />
          {canEdit && !editing && <button type="button" className="btn sm primary" onClick={() => setEditing(true)}>✎ 원고 수정</button>}
        </div>
      )}
      {editing ? <DocxEditor key={f.url} f={f} onClose={() => setEditing(false)} /> : <DocxView url={f.url} />}
    </div>
  );
}

type Loaded = Awaited<ReturnType<typeof import("./docxEdit").loadDocx>>;   // jszip 은 수정할 때만 불러온다

function DocxEditor({ f, onClose }: { f: EditableFile; onClose: () => void }) {
  const router = useRouter();
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [err, setErr] = useState(false);
  const [text, setText] = useState<Map<number, string>>(new Map());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const buf = await (await fetch(f.url!)).arrayBuffer();
      const d = await (await import("./docxEdit")).loadDocx(buf);
      if (alive) setDoc(d);
    })().catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [f.url]);

  const changed = doc ? doc.paras.filter((p) => text.has(p.idx) && text.get(p.idx) !== p.text).length : 0;

  async function cancel() {
    if (changed && !(await ask(`고친 문단 ${changed}개가 저장되지 않았습니다. 수정을 취소할까요?`))) return;
    onClose();
  }
  async function save() {
    if (!doc || busy) return;
    if (!changed) return toastError("고친 내용이 없습니다.");
    setBusy(true);
    try {
      const blob = await (await import("./docxEdit")).saveDocx(doc, text);
      if (!blob) { setBusy(false); return toastError("고친 내용이 없습니다."); }
      const form = new FormData();
      form.append("fileId", f.id);
      form.append("file", new File([blob], f.name, { type: blob.type }));
      const { error } = await supabaseBrowser().functions.invoke("review-edit", { body: form });
      if (error) {
        let msg = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        try { const j = await (error as { context?: Response }).context?.json(); if (j?.error && j.error !== "forbidden") msg = j.error; else if (j?.error) msg = "이 원고를 수정할 권한이 없습니다."; } catch { /* 기본 안내 */ }
        setBusy(false);
        return toastError(msg);
      }
      toast(`원고를 저장했습니다. 고친 부분은 형광 + 빨간 글씨로 표시됩니다.`);
      onClose();
      router.refresh();
    } catch {
      setBusy(false);
      toastError("원고를 저장용 파일로 만들지 못했습니다.");
    }
  }

  if (err) return <div className="notice">이 원고는 화면에서 수정할 수 없습니다. 파일을 내려받아 수정해 주세요.</div>;
  if (!doc) return <div className="faint pad-x">원고 불러오는 중…</div>;
  const locked = doc.paras.filter((p) => !p.editable && p.text.trim()).length;
  return (
    <div className="rv-editor">
      <div className="rv-editor-bar">
        <b>원고 수정 중</b>
        <span className="faint">{changed ? `고친 문단 ${changed}개` : "문단을 눌러 바로 고치세요"}{locked ? ` · 이미지 · 링크가 있는 문단 ${locked}개는 수정할 수 없습니다` : ""}</span>
        <span className="rv-editor-act">
          <button type="button" className="btn sm" disabled={busy} onClick={cancel}>취소</button>
          <button type="button" className="btn sm primary" disabled={busy || !changed} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
        </span>
      </div>
      <div className="docx-view rv-paras">
        {doc.paras.map((p) => {
          if (!p.editable) return p.text.trim() ? <p key={p.idx} className="rv-locked" title="이미지 · 링크 등이 있어 화면에서 수정할 수 없는 문단">{p.text}</p> : null;
          const v = text.get(p.idx) ?? p.text;
          const dirty = v !== p.text;
          return <Para key={p.idx} value={v} heading={p.heading} cls={`${dirty ? "dirty" : ""} ${p.edited ? "was-edited" : ""}`}
            onChange={(nv) => setText((m) => new Map(m).set(p.idx, nv))} />;
        })}
      </div>
    </div>
  );
}

// 문단 입력칸: 글 길이에 맞춰 높이가 늘어난다
function Para({ value, heading, cls, onChange }: { value: string; heading: boolean; cls: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} className={`rv-para ${heading ? "h" : ""} ${cls}`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label="문단" />;
}
