"use client";
// 리포트 각 메뉴의 직원용 입력 도구 (직원 경로에서만 서버가 그린다)
// - 내용 추가: 블로그 원고 · 홈페이지 칼럼 · 카페/당근 게시글 · 카드뉴스 회차를 이 달 리포트에 바로 등록
// - 추가 계약: 견적서 확정 내용과 별개로 중간에 추가된 업무(수량·마감일·메모) → add_extra_work
// 저장은 로그인 세션으로 하며, DB 규칙(RLS·함수)이 담당 여부를 다시 확인한다.
import { toast } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type SectionKind = "blog" | "column" | "place" | "cafe" | "daangn" | "cardnews";
const NAMES: Record<SectionKind, { item: string; svc: string }> = {
  blog: { item: "블로그 원고", svc: "블로그" },
  column: { item: "홈페이지 칼럼", svc: "홈페이지 칼럼" },
  place: { item: "플레이스 키워드", svc: "플레이스" },
  cafe: { item: "카페 게시글", svc: "카페 바이럴" },
  daangn: { item: "당근 게시글", svc: "당근마켓 바이럴" },
  cardnews: { item: "카드뉴스 회차", svc: "SNS 카드뉴스" },
};
const isUrl = (v: string) => /^https?:\/\/\S+$/.test(v);
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (v: string) => (v === "" ? null : Math.max(0, Math.floor(Number(v.replace(/[^\d]/g, "")) || 0)));

export type ContractSummary = { quantity: number; extra: number; done: number; dueOn: string | null } | null;

export default function SectionTools({ clientId, period, kind, contracted, lastDay, nextRound, summary, initialOpen = null, inHouse = false }: {
  clientId: string; period: string; kind: SectionKind; contracted: boolean; lastDay: string; nextRound: number; summary: ContractSummary;
  inHouse?: boolean;                          // 자사 마케팅: '추가 계약' 대신 '항목 추가'
  initialOpen?: "content" | "extra" | null;   // 대시보드의 [+ 추가하기]로 들어오면 추가 계약 입력이 열린 상태
}) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [open, setOpen] = useState<"content" | "extra" | null>(initialOpen);
  const [busy, setBusy] = useState(false);
  // 저장 결과는 화면 아래 알림으로
  const setMsg = (m: { ok: boolean; text: string } | null) => { if (m) toast(m.text, { kind: m.ok ? "ok" : "error" }); };
  const n = NAMES[kind];
  const finish = (ok: boolean, text: string, form?: HTMLFormElement) => {
    setBusy(false); setMsg({ ok, text });
    if (ok) { form?.reset(); setOpen(null); router.refresh(); }
  };

  async function addContent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    const url = s(fd, "url");
    if (kind !== "cardnews" && kind !== "place" && !isUrl(url)) return setMsg({ ok: false, text: "주소는 http:// 또는 https:// 로 시작해야 합니다." });
    setBusy(true); setMsg(null);
    let error: unknown = null;
    if (kind === "blog") {
      ({ error } = await sb.from("blog_posts").insert({ client_id: clientId, period, keyword: s(fd, "keyword"), title: s(fd, "title"), url, published_on: s(fd, "date") || null }));
    } else if (kind === "place") {
      ({ error } = await sb.from("tracked_keywords").upsert({ client_id: clientId, kind: "place", keyword: s(fd, "keyword"), active: true }, { onConflict: "client_id,kind,keyword" }));
    } else if (kind === "column") {
      ({ error } = await sb.from("web_columns").insert({ client_id: clientId, period, title: s(fd, "title"), url, published_on: s(fd, "date") || null }));
    } else if (kind === "cafe" || kind === "daangn") {
      ({ error } = await sb.from("cafe_posts").insert({
        client_id: clientId, period, channel: kind, posted_on: s(fd, "date") || null, cafe_name: s(fd, "where"), url,
        title: s(fd, "title") || null, views: int(s(fd, "views")), comments: int(s(fd, "comments")),
      }));
    } else {
      const links = [["인스타그램", "insta"], ["카카오채널", "kakao"], ["당근마켓", "daangn"]]
        .map(([media, k]) => ({ media, url: s(fd, k) })).filter((l) => l.url);
      if (links.length === 0) { setBusy(false); return setMsg({ ok: false, text: "게시물 주소를 하나 이상 입력해 주세요." }); }
      if (links.some((l) => !isUrl(l.url))) { setBusy(false); return setMsg({ ok: false, text: "게시물 주소는 http:// 또는 https:// 로 시작해야 합니다." }); }
      const round = int(s(fd, "round")) ?? nextRound;
      const { data: rr, error: e1 } = await sb.from("cardnews_rounds")
        .upsert({ client_id: clientId, period, round_no: round, posted_on: s(fd, "date") || null, topic: s(fd, "topic") || null }, { onConflict: "client_id,period,round_no" })
        .select("id").single();
      error = e1;
      if (!e1 && rr) ({ error } = await sb.from("cardnews_links").insert(links.map((l) => ({ round_id: rr.id, client_id: clientId, ...l }))));
    }
    finish(!error, error ? `${n.item}을(를) 저장하지 못했습니다. 입력값을 확인해 주세요.` : `${n.item}을(를) 추가했습니다.`, form);
  }

  async function addExtra(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; const fd = new FormData(form);
    const qty = int(s(fd, "qty"));
    if (!qty) return setMsg({ ok: false, text: "수량을 1 이상으로 입력해 주세요." });
    setBusy(true); setMsg(null);
    const { error } = await sb.rpc("add_extra_work", {
      p_client: clientId, p_period: period, p_service: kind, p_label: s(fd, "label") || null,
      p_quantity: qty, p_due: s(fd, "due") || lastDay, p_note: s(fd, "note") || null,
    });
    finish(!error, error ? `${inHouse ? "항목" : "추가 계약"}을 저장하지 못했습니다.` : `${n.svc} ${qty}건을 ${inHouse ? "업무 항목" : "추가 진행 업무"}으로 등록했습니다.${contracted ? "" : " 이제 이 메뉴가 진행 중으로 바뀝니다."}`, form);
  }

  const pct = summary && summary.quantity ? Math.min(100, (summary.done / summary.quantity) * 100) : 0;

  return (
    <section className="card pad sec-tools">
      <div className="st-head">
        <div className="st-sum">
          <span className="badge acc">직원용</span>
          {summary && summary.quantity > 0 ? (
            <>
              <b>{period.replace("-", "년 ")}월 {inHouse ? "업무" : "계약"} {summary.quantity}건</b>
              {summary.extra > 0 && <span className="faint">(추가 {summary.extra}건 포함)</span>}
              <span className="bar thin st-bar"><i style={{ width: `${pct}%` }} /></span>
              <span className="num">진행 {summary.done}건</span>
              {summary.dueOn && <span className="faint">· 마감 {summary.dueOn.slice(5).replace("-", "/")}</span>}
            </>
          ) : <span className="faint">{inHouse ? (contracted ? "이번 달 수량이 등록되지 않았습니다." : "이번 달 진행하지 않는 항목") : contracted ? "이번 달 계약 수량이 등록되지 않았습니다." : "미집행 · 이번 달 계약 수량 없음"}</span>}
        </div>
        <div className="row">
          <button className={`btn sm ${open === "content" ? "primary" : ""}`} onClick={() => { setOpen(open === "content" ? null : "content"); setMsg(null); }}>+ {n.item} 추가</button>
          <button className={`btn sm ${open === "extra" ? "primary" : ""}`} onClick={() => { setOpen(open === "extra" ? null : "extra"); setMsg(null); }}>{inHouse ? "+ 항목 추가" : "+ 추가 계약"}</button>
        </div>
      </div>

      {open === "content" && (
        <form className="st-form" onSubmit={addContent} autoComplete="off">
          {kind === "blog" && <>
            <label>키워드 *<input name="keyword" required maxLength={60} className="search" /></label>
            <label className="w2">포스팅 제목 *<input name="title" required maxLength={200} className="search" /></label>
            <label className="w2">포스팅 주소 *<input name="url" required className="search" placeholder="https://blog.naver.com/..." /></label>
            <label>발행일<input name="date" type="date" className="search" /></label>
          </>}
          {kind === "place" && <>
            <label className="w2">플레이스 순위 키워드 *<input name="keyword" required maxLength={60} className="search" placeholder="예: 청량리 안과" /></label>
            <p className="faint w2">순위는 매일 오전 9시 수집 또는 요청 시 수집 때 반영됩니다.</p>
          </>}
          {kind === "column" && <>
            <label className="w2">칼럼 제목 *<input name="title" required maxLength={200} className="search" /></label>
            <label className="w2">칼럼 주소 *<input name="url" required className="search" placeholder="https://..." /></label>
            <label>게시일<input name="date" type="date" className="search" /></label>
          </>}
          {(kind === "cafe" || kind === "daangn") && <>
            <label>{kind === "cafe" ? "카페명 *" : "지역 · 게시판 *"}<input name="where" required maxLength={60} className="search" placeholder={kind === "cafe" ? "예: 청량리맘" : "예: 전농동 동네생활"} /></label>
            <label className="w2">게시글 주소 *<input name="url" required className="search" placeholder="https://..." /></label>
            <label className="w2">제목<input name="title" maxLength={200} className="search" /></label>
            <label>업로드일<input name="date" type="date" className="search" /></label>
            <label>조회수<input name="views" inputMode="numeric" className="search" /></label>
            <label>댓글수<input name="comments" inputMode="numeric" className="search" /></label>
          </>}
          {kind === "cardnews" && <>
            <label>회차<input name="round" inputMode="numeric" defaultValue={nextRound} className="search" /></label>
            <label>게시일<input name="date" type="date" className="search" /></label>
            <label className="w2">주제<input name="topic" maxLength={100} className="search" /></label>
            <label className="w2">인스타그램 주소<input name="insta" className="search" placeholder="https://www.instagram.com/p/..." /></label>
            <label className="w2">카카오 소식 주소<input name="kakao" className="search" placeholder="https://pf.kakao.com/..." /></label>
            <label className="w2">당근 소식 주소<input name="daangn" className="search" placeholder="https://www.daangn.com/..." /></label>
          </>}
          <div className="st-act"><button className="btn primary sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button><button type="button" className="btn sm" onClick={() => setOpen(null)}>취소</button></div>
        </form>
      )}

      {open === "extra" && (
        <form className="st-form" onSubmit={addExtra} autoComplete="off">
          <p className="faint w-all">{inHouse ? "이번 달 진행할 업무 수량과 마감일을 등록합니다. 대시보드·진행 현황의 진행률과 마감 관리에 포함됩니다." : "견적서에 없던 업무를 중간에 추가로 진행할 때 등록합니다. 대시보드·진행 현황에 ‘추가’로 표시되고, 계약 수량과 마감 관리에 포함됩니다."}</p>
          <label>{inHouse ? "수량" : "추가 수량"} *<input name="qty" required inputMode="numeric" className="search" placeholder="예: 2" /></label>
          <label>마감일<input name="due" type="date" defaultValue={lastDay} className="search" /></label>
          <label className="w2">세부 내용<input name="label" maxLength={60} className="search" placeholder="예: 이벤트 홍보용" /></label>
          <label className="w-all">{inHouse ? "메모 (내부용)" : "추가 사유 · 요청 내용 (내부용)"}<input name="note" maxLength={300} className="search" placeholder={inHouse ? "" : "예: 10/15 원장님 요청, 추가 비용 별도 청구"} /></label>
          <div className="st-act"><button className="btn primary sm" disabled={busy}>{busy ? "저장 중…" : inHouse ? "항목 등록" : "추가 계약 등록"}</button><button type="button" className="btn sm" onClick={() => setOpen(null)}>취소</button></div>
        </form>
      )}
    </section>
  );
}
