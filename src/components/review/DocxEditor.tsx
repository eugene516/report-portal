"use client";
// Word 원고 보기 + 화면에서 바로 수정 (블로그 · 홈페이지 칼럼)
// - '✎ 원고 수정'을 누르면 문단마다 입력칸이 열리고, 원고 안 이미지는 교체 · 삭제할 수 있다
// - 저장하면 고친 글자와 이미지 교체 · 삭제 자리가 노란 형광 + 빨간 글씨로 표시된 Word 파일이 된다
// - 저장은 review-edit 함수가 권한(직원: 검수 완료 전 · 광고주: 검수 대기 중)을 확인한 뒤 새 파일로 바꾼다. 처음 원본은 따로 보관
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
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
        // 스크롤해도 '원고 수정' 버튼이 위에 붙어 있게 (수정 중에는 저장 · 취소 줄이 대신 붙는다)
        <div className={`rv-docx-bar ${editing ? "" : "stick"}`}>
          <EditedNote f={f} />
          {canEdit && !editing && <button type="button" className="btn sm primary" onClick={() => setEditing(true)}>✎ 원고 수정</button>}
        </div>
      )}
      {editing ? <DocxEditor key={f.url} f={f} onClose={() => setEditing(false)} /> : <DocxView url={f.url} />}
    </div>
  );
}

type Mod = typeof import("./docxEdit");   // jszip 은 수정할 때만 불러온다
type Loaded = Awaited<ReturnType<Mod["loadDocx"]>>;
type Change = import("./docxEdit").ParaChange;
type Para = import("./docxEdit").EditPara;
type Act = "delete" | File | null;

const unchanged = (p: Para, c: Change | undefined) => !c || (c.segs.every((x, i) => x === p.segs[i]) && c.objs.every((o) => o === null));

function DocxEditor({ f, onClose }: { f: EditableFile; onClose: () => void }) {
  const router = useRouter();
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [err, setErr] = useState(false);
  const [changes, setChanges] = useState<Map<number, Change>>(new Map());
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());   // 교체할 이미지 미리보기 주소 ("문단:그림")
  const [busy, setBusy] = useState(false);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    let loaded: Loaded | null = null;
    const made = urls.current;
    (async () => {
      const buf = await (await fetch(f.url!)).arrayBuffer();
      loaded = await (await import("./docxEdit")).loadDocx(buf);
      if (alive) setDoc(loaded); else loaded.dispose();
    })().catch(() => { if (alive) setErr(true); });
    return () => { alive = false; loaded?.dispose(); made.forEach((u) => URL.revokeObjectURL(u)); made.clear(); };
  }, [f.url]);

  const changed = doc ? doc.paras.filter((p) => !unchanged(p, changes.get(p.idx))).length : 0;
  const cur = (p: Para): Change => changes.get(p.idx) ?? { segs: [...p.segs], objs: p.objs.map(() => null) };
  const update = (p: Para, fn: (c: Change) => Change) => setChanges((m) => new Map(m).set(p.idx, fn(m.get(p.idx) ?? cur(p))));
  const setSeg = (p: Para, i: number, v: string) => update(p, (c) => ({ ...c, segs: c.segs.map((x, k) => (k === i ? v : x)) }));
  const setObj = (p: Para, i: number, act: Act) => {
    const key = `${p.idx}:${i}`;
    setPreviews((m) => {
      const n = new Map(m);
      const old = n.get(key);
      if (old) { URL.revokeObjectURL(old); urls.current.delete(old); n.delete(key); }
      if (act instanceof File) { const u = URL.createObjectURL(act); urls.current.add(u); n.set(key, u); }
      return n;
    });
    update(p, (c) => ({ ...c, objs: c.objs.map((x, k) => (k === i ? act : x)) }));
  };

  async function cancel() {
    if (changed && !(await ask(`고친 문단 ${changed}개가 저장되지 않았습니다. 수정을 취소할까요?`))) return;
    onClose();
  }
  async function save() {
    if (!doc || busy) return;
    if (!changed) return toastError("고친 내용이 없습니다.");
    setBusy(true);
    try {
      const blob = await (await import("./docxEdit")).saveDocx(doc, changes);
      if (!blob) { setBusy(false); return toastError("고친 내용이 없습니다."); }
      if (blob.size > 30 * 1024 * 1024) { setBusy(false); return toastError("저장할 원고가 30MB를 넘습니다. 더 작은 이미지로 바꿔 주세요."); }
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
      toast("원고를 저장했습니다. 고친 부분은 형광 + 빨간 글씨로 표시됩니다.");
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
        <span className="faint">{changed ? `고친 문단 ${changed}개` : "문단을 눌러 고치고, 이미지는 ‘이미지 교체’로 바꾸세요"}{locked ? ` · 수정할 수 없는 문단 ${locked}개(회색)` : ""}</span>
        <span className="rv-editor-act">
          <button type="button" className="btn sm" disabled={busy} onClick={cancel}>취소</button>
          <button type="button" className="btn sm primary" disabled={busy || !changed} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
        </span>
      </div>
      <div className="docx-view rv-paras">
        {doc.paras.map((p) => {
          if (!p.editable) return p.text.trim() ? <p key={p.idx} className="rv-locked" title="각주 · 필드 · 변경 추적 등이 있어 화면에서 수정할 수 없는 문단">{p.text}</p> : null;
          const c = cur(p);
          return (
            <div key={p.idx} className="rv-pblock">
              {c.segs.map((v, i) => (
                <Fragment key={i}>
                  {/* 그림이 있는 문단의 빈 글 구간(그림 앞뒤 빈 줄)은 숨긴다 */}
                  {(p.objs.length === 0 || p.segs[i] !== "" || v !== "") && (
                    <ParaBox value={v} heading={p.heading} cls={`${v !== p.segs[i] ? "dirty" : ""} ${p.edited ? "was-edited" : ""}`} onChange={(nv) => setSeg(p, i, nv)} />
                  )}
                  {p.objs[i] && <ImageBlock obj={p.objs[i]} act={c.objs[i] ?? null} preview={previews.get(`${p.idx}:${i}`) ?? null} onAct={(a) => setObj(p, i, a)} />}
                </Fragment>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 원고 안 이미지: 교체(새 파일 고르기) · 삭제 · 되돌리기
function ImageBlock({ obj, act, preview, onAct }: { obj: Para["objs"][number]; act: Act; preview: string | null; onAct: (a: Act) => void }) {
  const input = useRef<HTMLInputElement>(null);
  if (obj.kind !== "image") return <div className="rv-img other faint">그림 요소 (화면에서 바꿀 수 없음)</div>;
  const state = act === "delete" ? "del" : act ? "new" : "";
  return (
    <figure className={`rv-img ${state}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview ? <img src={preview} alt="바꿀 이미지" /> : obj.src ? <img src={obj.src} alt="원고 이미지" /> : <span className="faint">이 형식의 이미지는 미리 볼 수 없습니다</span>}
      <figcaption>
        {state === "new" && <span className="badge warn">교체 예정</span>}
        {state === "del" && <span className="badge bad">삭제 예정</span>}
        <span className="rv-img-act">
          {state === "new" && <button type="button" className="btn sm" onClick={() => input.current?.click()}>다른 이미지</button>}
          {state ? <button type="button" className="btn sm" onClick={() => onAct(null)}>되돌리기</button> : (
            <>
              <button type="button" className="btn sm" onClick={() => input.current?.click()}>이미지 교체</button>
              <button type="button" className="btn sm ghost" onClick={() => onAct("delete")}>삭제</button>
            </>
          )}
        </span>
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) return toastError("이미지는 10MB 이하로 올려 주세요.");
          onAct(file);
        }} />
      </figcaption>
    </figure>
  );
}

// 문단 입력칸: 글 길이에 맞춰 높이가 늘어난다
function ParaBox({ value, heading, cls, onChange }: { value: string; heading: boolean; cls: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} className={`rv-para ${heading ? "h" : ""} ${cls}`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label="문단" />;
}
