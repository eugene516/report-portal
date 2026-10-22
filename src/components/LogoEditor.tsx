"use client";
// 광고주 로고 등록 (직원 경로에서만 서버가 그린다)
// - 이미지를 고르면 정사각형 틀 안에서 끌어서 위치를 옮기고, 슬라이더·마우스 휠로 크기를 조절한다
// - 저장하면 512×512 정사각형(webp)으로 잘라 logos/{client_id}/ 에 올리고 clients.logo_path 를 바꾼다
// - 저장소·표 규칙(담당·관리자만)이 권한을 다시 확인한다
import { ask } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { logoUrl } from "@/lib/logo";

const VIEW = 260;   // 편집 틀 크기(px)
const OUT = 512;    // 저장 크기(px)
type Img = { el: HTMLImageElement; w: number; h: number; url: string };


export default function LogoEditor({ clientId, name, current }: { clientId: string; name: string; current: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState<Img | null>(null);
  const [zoom, setZoom] = useState(1);          // 1 = 틀을 꽉 채우는 최소 크기
  const [pos, setPos] = useState({ x: 0, y: 0 }); // 이미지 왼쪽 위 위치(틀 기준)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const base = img ? VIEW / Math.min(img.w, img.h) : 1;
  const scale = base * zoom;
  const clamp = (x: number, y: number, s = scale) => img ? {
    x: Math.min(0, Math.max(VIEW - img.w * s, x)),
    y: Math.min(0, Math.max(VIEW - img.h * s, y)),
  } : { x, y };

  useEffect(() => () => { if (img) URL.revokeObjectURL(img.url); }, [img]);

  function pick(file: File | undefined) {
    setErr(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return setErr("PNG · JPG · WEBP 이미지만 올릴 수 있습니다.");
    if (file.size > 15 * 1024 * 1024) return setErr("15MB 이하 이미지만 올릴 수 있습니다.");
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      const s = VIEW / Math.min(el.naturalWidth, el.naturalHeight);
      setImg({ el, w: el.naturalWidth, h: el.naturalHeight, url });
      setZoom(1);
      setPos({ x: (VIEW - el.naturalWidth * s) / 2, y: (VIEW - el.naturalHeight * s) / 2 });   // 가운데 맞춤
    };
    el.onerror = () => setErr("이미지를 읽지 못했습니다.");
    el.src = url;
  }

  // 틀 가운데를 기준으로 확대·축소
  function setZoomAt(z: number) {
    if (!img) return;
    const nz = Math.min(4, Math.max(1, z));
    const ns = base * nz;
    const cx = (VIEW / 2 - pos.x) / scale, cy = (VIEW / 2 - pos.y) / scale;
    setZoom(nz);
    setPos(clamp(VIEW / 2 - cx * ns, VIEW / 2 - cy * ns, ns));
  }

  async function save() {
    if (!img) return;
    setBusy(true); setErr(null);
    const canvas = document.createElement("canvas");
    canvas.width = OUT; canvas.height = OUT;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, OUT, OUT);   // 투명 배경은 흰색으로
    const r = OUT / VIEW;
    ctx.drawImage(img.el, pos.x * r, pos.y * r, img.w * scale * r, img.h * scale * r);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.9));
    if (!blob) { setBusy(false); return setErr("이미지를 만들지 못했습니다."); }
    const sb = supabaseBrowser();
    const path = `${clientId}/${crypto.randomUUID().replace(/-/g, "")}.webp`;
    const up = await sb.storage.from("logos").upload(path, blob, { contentType: "image/webp", upsert: false });
    if (up.error) { setBusy(false); return setErr("로고를 올리지 못했습니다."); }
    const { error } = await sb.from("clients").update({ logo_path: path, updated_at: new Date().toISOString() }).eq("id", clientId);
    if (error) { await sb.storage.from("logos").remove([path]); setBusy(false); return setErr("로고를 저장하지 못했습니다."); }
    if (current) await sb.storage.from("logos").remove([current]);   // 이전 로고 정리
    setBusy(false); setOpen(false); setImg(null);
    router.refresh();
  }

  async function removeLogo() {
    if (!current || !await ask("로고를 지울까요?")) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = await sb.from("clients").update({ logo_path: null, updated_at: new Date().toISOString() }).eq("id", clientId);
    if (!error) await sb.storage.from("logos").remove([current]);
    setBusy(false);
    if (error) return setErr("로고를 지우지 못했습니다.");
    setOpen(false); router.refresh();
  }

  return (
    <>
      <div className="logo-box">
        <button className={`logo-btn ${current ? "" : "empty"}`} onClick={() => { setOpen(true); setErr(null); }} title="로고 등록 · 변경" aria-label="로고 등록 · 변경">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {current ? <img src={logoUrl(current)} alt={`${name} 로고`} /> : <span>+ 로고 등록</span>}
        </button>
        {current && <button className="logo-edit" onClick={() => { setOpen(true); setErr(null); }}>✎ 로고 수정</button>}
      </div>

      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="로고 등록">
          <div className="modal-backdrop" onClick={() => !busy && setOpen(false)} />
          <div className="modal-panel logo-panel">
            <button className="modal-x" onClick={() => setOpen(false)} aria-label="닫기">×</button>
            <h2>{name} 로고</h2>
            <p className="faint">정사각형으로 저장됩니다. 이미지를 끌어서 위치를 맞추고, 아래 막대나 마우스 휠로 크기를 조절하세요.</p>

            <div className="crop-wrap">
              <div className="crop" style={{ width: VIEW, height: VIEW }}
                onPointerDown={(e) => { if (!img) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }; }}
                onPointerMove={(e) => { const d = drag.current; if (d) setPos(clamp(d.x + e.clientX - d.px, d.y + e.clientY - d.py)); }}
                onPointerUp={() => { drag.current = null; }}
                onWheel={(e) => { if (img) setZoomAt(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }}>
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt="" draggable={false} style={{ width: img.w * scale, height: img.h * scale, transform: `translate(${pos.x}px, ${pos.y}px)` }} />
                ) : current ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl(current)} alt="" style={{ width: VIEW, height: VIEW }} />
                ) : <span className="faint">이미지를 선택하세요</span>}
              </div>
            </div>

            {img && (
              <label className="zoom-row">
                <span className="faint">크기</span>
                <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoomAt(Number(e.target.value))} aria-label="크기 조절" />
                <span className="num faint">{Math.round(zoom * 100)}%</span>
              </label>
            )}
            {err && <div className="notice mt-s">{err}</div>}

            <div className="row mt logo-actions">
              <label className="btn">{img ? "다른 이미지" : "이미지 선택"}<input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} /></label>
              {current && !img && <button className="btn" disabled={busy} onClick={removeLogo}>로고 지우기</button>}
              <span style={{ flex: 1 }} />
              <button className="btn" onClick={() => setOpen(false)} disabled={busy}>취소</button>
              <button className="btn primary" onClick={save} disabled={!img || busy}>{busy ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
