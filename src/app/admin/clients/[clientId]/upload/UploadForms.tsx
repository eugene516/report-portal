"use client";
// 데이터 업로드
// 1) ego-browser 수집 결과(JSON + 캡쳐 이미지) → 블로그·플레이스 순위, 카페 캡쳐
// 2) 엑셀에서 복사한 표 붙여넣기 → 블로그 원고 · 카페 배포 · 카드뉴스 · 칼럼 · 추적 키워드
// 모든 저장은 로그인 세션으로 하며, DB·저장소 규칙이 담당 여부를 다시 확인한다.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Other = { rank: number; url?: string; post?: string } | null;
// 수집 스크립트는 "다른 글"을 {rank, post(글번호)}로 남긴다 → 원고 주소의 블로그 계정으로 글 주소를 만든다
const otherUrl = (o: Other | undefined, postUrl?: string) => {
  if (!o) return null;
  if (o.url) return { rank: o.rank, url: o.url };
  const m = postUrl?.match(/^(https?:\/\/(?:m\.)?blog\.naver\.com\/[^/]+)\//);
  return o.post && m ? { rank: o.rank, url: `${m[1]}/${o.post}` } : null;
};
type BlogRow = { keyword: string; url?: string; main: number | null; blogTab: number | null; mainOther?: Other; tabOther?: Other };
type PlaceRow = { keyword: string; rank: number | null; adRank?: number | null; capture?: string };
type CafeRow = { url: string; status?: string; currentViews?: number | null; currentComments?: number | null; capturedAt?: string; capture?: string; captureSource?: "live" | "report" };

const n = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
const baseName = (p?: string) => (p ?? "").split(/[\\/]/).pop() ?? "";
const stamp = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", "_").replace(":", "");

async function uploadCapture(sb: SupabaseClient, clientId: string, kind: string, at: string, idx: number, file: File) {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${clientId}/${kind}/${stamp(at)}/${String(idx + 1).padStart(2, "0")}.${ext}`;
  const { error } = await sb.storage.from("captures").upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
  return error ? null : path;
}

const PASTE_TYPES = {
  blog: { label: "블로그 원고", cols: "키워드 | 포스팅 제목 | 포스팅 URL | (발행일 YYYY-MM-DD)" },
  cafe: { label: "카페 배포", cols: "업로드일 | 카페명 | 게시글 URL | 조회수 | 댓글수 | (특이사항)" },
  cardnews: { label: "SNS 카드뉴스", cols: "회차 | 매체(인스타그램·당근마켓·카카오채널) | 게시물 URL" },
  column: { label: "홈페이지 칼럼", cols: "칼럼 제목 | URL" },
  kw_place: { label: "플레이스 키워드", cols: "키워드 (한 줄에 하나)" },
  kw_blog_extra: { label: "추가 노출 키워드", cols: "키워드 (한 줄에 하나)" },
  kw_aeo: { label: "AEO 키워드", cols: "키워드 (한 줄에 하나)" },
  kw_etc: { label: "기타 노출 키워드", cols: "키워드 (한 줄에 하나)" },
} as const;
type PasteType = keyof typeof PASTE_TYPES;

export default function UploadForms({ clientId, defaultPeriod, recent }: { clientId: string; defaultPeriod: string; recent: { kind: string; item_count: number; note: string | null; created_at: string }[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ptype, setPtype] = useState<PasteType>("blog");
  const done = (ok: boolean, text: string) => { setMsg({ ok, text }); setBusy(false); if (ok) router.refresh(); };

  async function uploadResults(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const jsonFile = fd.get("json") as File | null;
    const images = (fd.getAll("images") as File[]).filter((f) => f.size > 0);
    if (!jsonFile || jsonFile.size === 0) return setMsg({ ok: false, text: "결과 파일(JSON)을 선택해 주세요." });
    let data: { collectedAt?: string; blog?: BlogRow[]; place?: PlaceRow[]; cafe?: CafeRow[]; results?: CafeRow[] };
    try { data = JSON.parse(await jsonFile.text()); } catch { return setMsg({ ok: false, text: "JSON 파일을 읽지 못했습니다." }); }
    const at = data.collectedAt ?? new Date().toISOString();
    const byName = new Map(images.map((f) => [f.name, f]));
    const sb = supabaseBrowser();
    setBusy(true); setMsg(null);
    const kind = data.blog?.length ? "blog_rank" : data.place?.length ? "place_rank" : (data.cafe ?? data.results)?.length ? "cafe_capture" : null;
    if (!kind) return done(false, "블로그(blog) · 플레이스(place) · 카페(cafe) 결과를 찾지 못했습니다.");
    const count = (data.blog ?? data.place ?? data.cafe ?? data.results ?? []).length;
    const { data: up, error: e0 } = await sb.from("data_uploads").insert({ client_id: clientId, kind, item_count: count, note: `${jsonFile.name} (${images.length}장)` }).select("id").single();
    if (e0 || !up) return done(false, "업로드를 기록하지 못했습니다. 담당 광고주인지 확인해 주세요.");

    if (kind === "blog_rank") {
      const rows = data.blog!.map((b) => ({ client_id: clientId, keyword: b.keyword, post_url: b.url ?? null, main_rank: n(b.main), blog_tab_rank: n(b.blogTab), main_other: otherUrl(b.mainOther, b.url), tab_other: otherUrl(b.tabOther, b.url), collected_at: at, upload_id: up.id }));
      const { error } = await sb.from("blog_rank_results").insert(rows);
      return done(!error, error ? "블로그 순위를 저장하지 못했습니다." : `블로그 순위 ${rows.length}건을 저장했습니다.`);
    }
    if (kind === "place_rank") {
      let missing = 0;
      const rows = [];
      for (const [i, p] of data.place!.entries()) {
        const file = p.capture ? byName.get(baseName(p.capture)) : undefined;
        if (p.capture && !file) missing++;
        const path = file ? await uploadCapture(sb, clientId, "place", at, i, file) : null;
        rows.push({ client_id: clientId, keyword: p.keyword, rank: n(p.rank), ad_rank: n(p.adRank), capture_path: path, collected_at: at, upload_id: up.id });
      }
      const { error } = await sb.from("place_rank_results").insert(rows);
      await sb.from("tracked_keywords").upsert(rows.map((r, i) => ({ client_id: clientId, kind: "place", keyword: r.keyword, sort: i })), { onConflict: "client_id,kind,keyword", ignoreDuplicates: true });
      return done(!error, error ? "플레이스 순위를 저장하지 못했습니다." : `플레이스 ${rows.length}건을 저장했습니다.${missing ? ` (캡쳐 ${missing}장은 이미지 파일이 없어 빠졌습니다)` : ""}`);
    }
    // 카페 캡쳐: 기존 카페 게시글(URL 기준)에 현재 상태·캡쳐 반영
    let updated = 0, notFound = 0;
    for (const [i, c] of (data.cafe ?? data.results ?? []).entries()) {
      const file = c.capture ? byName.get(baseName(c.capture)) : undefined;
      const path = file ? await uploadCapture(sb, clientId, "cafe", c.capturedAt ?? at, i, file) : undefined;
      const patch: Record<string, unknown> = { captured_at: c.capturedAt ?? at };
      if (c.status) patch.status = c.status === "삭제됨" || c.status === "deleted" ? "삭제됨" : "게시중";
      if (c.currentViews !== undefined) patch.current_views = n(c.currentViews);
      if (c.currentComments !== undefined) patch.current_comments = n(c.currentComments);
      if (path) { patch.capture_path = path; patch.capture_source = c.captureSource ?? "live"; }
      const { data: hit } = await sb.from("cafe_posts").update(patch).eq("client_id", clientId).eq("url", c.url).select("id");
      if (hit?.length) updated++; else notFound++;
    }
    done(updated > 0, `카페 게시글 ${updated}건을 갱신했습니다.${notFound ? ` (${notFound}건은 등록된 카페 게시글 URL과 맞지 않습니다 — 먼저 '카페 배포'를 붙여넣기로 등록하세요)` : ""}`);
  }

  async function paste(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const period = String(fd.get("period") ?? "");
    const lines = String(fd.get("text") ?? "").split(/\r?\n/).map((l) => l.split("\t").map((c) => c.trim())).filter((c) => c.some(Boolean));
    if (!/^\d{4}-\d{2}$/.test(period)) return setMsg({ ok: false, text: "보고 월을 선택해 주세요." });
    if (!lines.length) return setMsg({ ok: false, text: "붙여넣은 내용이 없습니다." });
    const sb = supabaseBrowser();
    const url = (s: string) => /^https?:\/\//.test(s);
    setBusy(true); setMsg(null);
    let rows: Record<string, unknown>[] = [], table = "", bad = 0;
    if (ptype === "blog") {
      table = "blog_posts";
      rows = lines.filter((c) => { const ok = c[0] && c[1] && url(c[2] ?? ""); if (!ok) bad++; return ok; })
        .map((c, i) => ({ client_id: clientId, period, keyword: c[0], title: c[1], url: c[2], published_on: /^\d{4}-\d{2}-\d{2}$/.test(c[3] ?? "") ? c[3] : null, sort: i }));
    } else if (ptype === "cafe") {
      table = "cafe_posts";
      rows = lines.filter((c) => { const ok = c[1] && url(c[2] ?? ""); if (!ok) bad++; return ok; })
        .map((c, i) => ({ client_id: clientId, period, posted_on: /^\d{4}-\d{2}-\d{2}/.test(c[0]) ? c[0].slice(0, 10) : null, cafe_name: c[1], url: c[2], views: n(c[3]), comments: n(c[4]),
                          note: c[5] || null, status: /삭제/.test(c[5] ?? "") ? "삭제됨" : "게시중", sort: i }));
    } else if (ptype === "column") {
      table = "web_columns";
      rows = lines.filter((c) => { const ok = c[0] && url(c[1] ?? ""); if (!ok) bad++; return ok; }).map((c, i) => ({ client_id: clientId, period, title: c[0], url: c[1], sort: i }));
    } else if (ptype === "cardnews") {
      const groups = new Map<number, { media: string; url: string }[]>();
      for (const c of lines) { const r = n(c[0]); if (!r || !url(c[2] ?? "")) { bad++; continue; } groups.set(r, [...(groups.get(r) ?? []), { media: c[1] || "기타", url: c[2] }]); }
      let saved = 0;
      for (const [round, links] of groups) {
        const { data: rr } = await sb.from("cardnews_rounds").upsert({ client_id: clientId, period, round_no: round }, { onConflict: "client_id,period,round_no" }).select("id").single();
        if (!rr) continue;
        const { error } = await sb.from("cardnews_links").insert(links.map((l) => ({ round_id: rr.id, client_id: clientId, ...l })));
        if (!error) saved += links.length;
      }
      await sb.from("data_uploads").insert({ client_id: clientId, kind: "content", item_count: saved, note: `카드뉴스 ${period}` });
      return done(saved > 0, `카드뉴스 링크 ${saved}개를 저장했습니다.${bad ? ` (형식이 맞지 않는 ${bad}줄 제외)` : ""}`);
    } else {
      const kind = ptype.replace("kw_", "");
      table = "tracked_keywords";
      rows = lines.map((c, i) => ({ client_id: clientId, kind, keyword: c[0], sort: i, active: true }));
      const { error } = await sb.from(table).upsert(rows, { onConflict: "client_id,kind,keyword" });
      return done(!error, error ? "키워드를 저장하지 못했습니다." : `${PASTE_TYPES[ptype].label} ${rows.length}개를 저장했습니다.`);
    }
    if (!rows.length) return done(false, "형식에 맞는 줄이 없습니다. 열 순서를 확인해 주세요.");
    const { error } = await sb.from(table).insert(rows);
    if (!error) await sb.from("data_uploads").insert({ client_id: clientId, kind: "content", item_count: rows.length, note: `${PASTE_TYPES[ptype].label} ${period}` });
    done(!error, error ? "저장하지 못했습니다." : `${PASTE_TYPES[ptype].label} ${rows.length}건을 저장했습니다.${bad ? ` (형식이 맞지 않는 ${bad}줄 제외)` : ""}`);
  }

  return (
    <>
      {msg && <div className={`${msg.ok ? "planned" : "notice"} mt`}>{msg.text}</div>}

      <section className="card pad mt">
        <h2>순위 · 캡쳐 수집 결과 올리기 (ego-browser)</h2>
        <p className="faint">수집 스크립트가 만든 결과 파일(JSON)과 캡쳐 이미지를 함께 선택하세요. 블로그 · 플레이스 · 카페 결과를 자동으로 구분합니다. 이미지 파일 이름은 결과 파일의 capture 값과 같아야 합니다.</p>
        <form onSubmit={uploadResults} className="upload-form mt">
          <label>결과 파일 (JSON)<input type="file" name="json" accept=".json,application/json" required /></label>
          <label>캡쳐 이미지 (여러 장)<input type="file" name="images" accept="image/png,image/jpeg,image/webp" multiple /></label>
          <button className="btn primary" disabled={busy}>{busy ? "올리는 중…" : "올리기"}</button>
        </form>
      </section>

      <section className="card pad mt">
        <h2>엑셀에서 붙여넣기</h2>
        <p className="faint">엑셀 리포트에서 해당 열을 복사해 붙여넣으세요. 머리글 줄은 빼고 붙여넣습니다.</p>
        <form onSubmit={paste} className="mt">
          <div className="row">
            <select value={ptype} onChange={(e) => setPtype(e.target.value as PasteType)}>
              {Object.entries(PASTE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <label className="faint" htmlFor="period">보고 월</label>
            <input id="period" type="month" name="period" defaultValue={defaultPeriod} className="search date" />
          </div>
          <p className="faint mt-s">열 순서: {PASTE_TYPES[ptype].cols}</p>
          <textarea name="text" rows={10} className="paste" placeholder="엑셀에서 복사한 내용을 붙여넣으세요" />
          <div className="row mt-s"><button className="btn primary" disabled={busy}>{busy ? "저장 중…" : "저장"}</button></div>
        </form>
      </section>

      <section className="card pad mt">
        <h2>최근 업로드</h2>
        <ul className="list">
          {recent.length === 0 && <li className="faint">업로드 이력이 없습니다.</li>}
          {recent.map((r, i) => <li key={i}><span>{r.note ?? r.kind} · {r.item_count}건</span><span className="faint">{new Date(new Date(r.created_at).getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ")}</span></li>)}
        </ul>
      </section>
    </>
  );
}
