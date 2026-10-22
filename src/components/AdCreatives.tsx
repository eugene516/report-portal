"use client";
// 집행 중인 광고 소재 (광고 화면 맨 위)
// - 모두: 소재 이미지를 바둑판으로 보여주고, 누르면 원본이 열린다
// - 직원 화면(editable): 이미지 올리기(여러 장) · 이름 바꾸기 · 숨기기 · 삭제
//   이미지는 비공개 저장소 captures/{광고주}/creative/ 에 올리고, 저장소·표 규칙이 담당 여부를 다시 확인한다
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ask, toast, toastError } from "./ui";

export type Creative = { id: string; title: string | null; path: string; url: string | null };

export default function AdCreatives({ items, editable, clientId, channel, label }: {
  items: Creative[]; editable: boolean; clientId?: string; channel: string; label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!editable && items.length === 0) return null;

  async function upload(files: File[]) {
    if (!files.length || !clientId) return;
    setBusy(true);
    const sb = supabaseBrowser();
    let ok = 0;
    for (const f of files) {
      if (!/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 10 * 1024 * 1024) continue;
      const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
      const path = `${clientId}/creative/${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from("captures").upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) continue;
      const { error } = await sb.from("ad_creatives").insert({ client_id: clientId, channel, title: f.name.replace(/\.[^.]+$/, "").slice(0, 80), storage_path: path });
      if (error) { await sb.storage.from("captures").remove([path]); continue; }
      ok++;
    }
    setBusy(false);
    if (ok) { toast(`광고 소재 ${ok}개를 올렸습니다.`); router.refresh(); }
    if (ok < files.length) toastError(`${files.length - ok}개는 올리지 못했습니다 (PNG·JPG·WEBP, 10MB 이하).`);
  }
  async function rename(c: Creative) {
    const t = window.prompt("소재 이름", c.title ?? "");
    if (t === null) return;
    const { error } = await supabaseBrowser().from("ad_creatives").update({ title: t.trim().slice(0, 80) || null }).eq("id", c.id);
    if (error) return toastError("이름을 바꾸지 못했습니다.");
    router.refresh();
  }
  async function remove(c: Creative) {
    if (!await ask(`“${c.title ?? "소재"}”를 삭제할까요?\n광고주 리포트에서도 더 이상 보이지 않습니다.`)) return;
    const sb = supabaseBrowser();
    const { error } = await sb.from("ad_creatives").delete().eq("id", c.id);
    if (error) return toastError("삭제하지 못했습니다.");
    await sb.storage.from("captures").remove([c.path]);
    toast("삭제했습니다."); router.refresh();
  }

  return (
    <section className="card pad creatives">
      <div className="card-h">
        <h2>집행 중인 광고 소재</h2>
        {editable ? (
          <label className={`btn sm primary ${busy ? "disabled" : ""}`}>{busy ? "올리는 중…" : "+ 소재 이미지 올리기"}
            <input type="file" hidden multiple accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
        ) : <span className="faint">{label}</span>}
      </div>
      {items.length === 0 ? <div className="empty-state">등록된 광고 소재가 없습니다. 집행 중인 소재 이미지를 올려 주세요.</div> : (
        <div className="cr-grid">
          {items.map((c) => (
            <figure key={c.id} className="cr-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer"><img src={c.url} alt={c.title ?? "광고 소재"} loading="lazy" /></a> : <div className="noimg">이미지 없음</div>}
              <figcaption>
                <span>{c.title ?? "광고 소재"}</span>
                {editable && <span className="row cr-act"><button className="link-x" onClick={() => rename(c)} title="이름 바꾸기">✎</button><button className="link-x" onClick={() => remove(c)} title="삭제">🗑</button></span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
