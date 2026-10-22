"use client";
// 화면 공통 알림 · 확인 창
// - toast(문구, { kind, undo }): 화면 아래에 3초 동안 뜨는 알림. undo 를 주면 [되돌리기] 버튼이 붙고 5초 동안 보인다
// - confirmDialog({ title, body, ok, danger }): 브라우저 기본 확인창 대신 쓰는 확인 창 (Promise<boolean>)
// 루트 레이아웃의 <UiHost /> 하나가 모든 알림·확인 창을 그린다.
import { useEffect, useRef, useState } from "react";

type ToastItem = { id: number; text: string; kind: "ok" | "error" | "info"; undo?: () => void };
type ConfirmReq = { title: string; body?: string; ok?: string; danger?: boolean; resolve: (v: boolean) => void };

let seq = 0;
const bus = typeof window !== "undefined" ? new EventTarget() : null;

export function toast(text: string, opts: { kind?: ToastItem["kind"]; undo?: () => void } = {}) {
  bus?.dispatchEvent(new CustomEvent("toast", { detail: { id: ++seq, text, kind: opts.kind ?? "ok", undo: opts.undo } }));
}
export const toastError = (text: string) => toast(text, { kind: "error" });

export function confirmDialog(req: Omit<ConfirmReq, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    if (!bus) return resolve(false);
    bus.dispatchEvent(new CustomEvent("confirm", { detail: { ...req, resolve } }));
  });
}

// "제목\n설명" 문구를 받아 확인 창으로 묻는다. 삭제·폐기 같은 동작은 빨간 버튼
export function ask(message: string) {
  const [title, ...rest] = message.split("\n");
  const danger = /삭제|폐기|비활성화|제외|지울|양도/.test(title);
  return confirmDialog({ title, body: rest.join("\n") || undefined, danger, ok: danger ? "진행" : "확인" });
}

export function UiHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!bus) return;
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<ToastItem>).detail;
      setToasts((list) => [...list.slice(-3), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.undo ? 5000 : 3000);
    };
    const onConfirm = (e: Event) => setReq((e as CustomEvent<ConfirmReq>).detail);
    bus.addEventListener("toast", onToast);
    bus.addEventListener("confirm", onConfirm);
    return () => { bus.removeEventListener("toast", onToast); bus.removeEventListener("confirm", onConfirm); };
  }, []);
  useEffect(() => { if (req) okRef.current?.focus(); }, [req]);

  const answer = (v: boolean) => { req?.resolve(v); setReq(null); };

  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-i ${t.kind}`}>
            <span>{t.text}</span>
            {t.undo && <button onClick={() => { t.undo?.(); setToasts((l) => l.filter((x) => x.id !== t.id)); }}>되돌리기</button>}
          </div>
        ))}
      </div>
      {req && (
        <div className="modal" role="alertdialog" aria-modal="true" aria-label={req.title} onKeyDown={(e) => { if (e.key === "Escape") answer(false); }}>
          <div className="modal-backdrop" onClick={() => answer(false)} />
          <div className="modal-panel confirm-panel">
            <h2>{req.title}</h2>
            {req.body && <p className="confirm-body">{req.body}</p>}
            <div className="row confirm-act">
              <button className="btn" onClick={() => answer(false)}>취소</button>
              <button ref={okRef} className={`btn ${req.danger ? "danger-solid" : "primary"}`} onClick={() => answer(true)}>{req.ok ?? "확인"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
