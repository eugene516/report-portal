"use client";
// 문의관리 화면들: 보드(전체 · 진행중) · 대기/보류/미계약 정보 카드 · 계약 · 전체 목록
import { useMemo, useState } from "react";
import { useIq } from "./ctx";
import { BOARD_STAGES, diffDays, isActive, isStale, KIND_NAME, md, PARKED, stageChip, stageName, STAGES, statusOf,
  type Inquiry, type IqEvent, type Stage } from "./model";

const sevRank = (cls: string) => (cls === "danger" ? 0 : cls === "warn" ? 1 : 2);

function OwnerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { staff } = useIq();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="담당자">
      <option value="">담당자 전체</option>
      {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

// ── 보드 ─────────────────────────────────────────────────────────────
// 문의 수정 · 삭제 버튼 (카드 · 목록 공통). 누르면 카드 펼치기 · 상세 열기로 번지지 않게 막는다
function CardActions({ c }: { c: Inquiry }) {
  const { openCard, canDelete, removeCard } = useIq();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className="iq-acts" onClick={stop} onKeyDown={stop}>
      <button type="button" className="iq-ib" title="수정" aria-label={`${c.company} 수정`} onClick={() => openCard(c.id)}>✎</button>
      {canDelete(c) && <button type="button" className="iq-ib del" title="삭제" aria-label={`${c.company} 삭제`} onClick={() => removeCard(c)}>🗑</button>}
    </span>
  );
}

export function BoardView({ stages, title, desc }: { stages: typeof STAGES; title: string; desc: string }) {
  const { cards, settings, today, nameOf, canManage, setStage, openCard } = useIq();
  const [owner, setOwner] = useState("");
  const [over, setOver] = useState<Stage | null>(null);
  const pool = cards.filter((c) => stages.some((s) => s.id === c.stage) && (!owner || c.owner === owner));
  const stale = pool.filter((c) => isStale(c, settings.sla, today)).length;

  async function drop(e: React.DragEvent, to: Stage) {
    setOver(null);
    const id = e.dataTransfer.getData("text/inquiry");
    const c = cards.find((x) => x.id === id);
    if (!c) return;
    e.preventDefault();
    if (c.stage === to) return;
    if (await setStage(c, to) && PARKED.includes(to)) openCard(c.id);   // 대기·보류 등으로 보내면 날짜·사유를 바로 적도록 상세를 연다
  }

  return (
    <section>
      <div className="iq-top">
        <div>
          <h2>{title}</h2>
          <p>
            {stale ? <span className="iq-chip warn">놓치고 있는 문의 {stale}건</span> : <span className="iq-chip ok">모두 제때 대응 중</span>}{" "}
            {desc} 색 띠: 주황 = 기준일 넘김, 빨강 = 다음 액션 지남
          </p>
        </div>
        <OwnerSelect value={owner} onChange={setOwner} />
      </div>
      <div className="iq-board">
        {stages.map((s) => {
          const list = pool.filter((c) => c.stage === s.id)
            .map((c) => ({ c, t: statusOf(c, settings.sla, today) }))
            .sort((a, b) => sevRank(a.t.cls) - sevRank(b.t.cls) || b.c.received_on.localeCompare(a.c.received_on));
          return (
            <div key={s.id} className={`iq-col ${over === s.id ? "over" : ""}`}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("text/inquiry")) { e.preventDefault(); setOver(s.id); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
              onDrop={(e) => drop(e, s.id)}>
              <h3><span>{s.name} <span className="iq-n">{list.length}</span></span>{s.sla && settings.sla[s.id] != null && <span className="iq-sla">기준 {settings.sla[s.id]}일</span>}</h3>
              <div className="iq-cards">
                {list.length === 0 && <div className="iq-col-empty">없음</div>}
                {list.map(({ c, t }) => {
                  const dd = c.stage === "won" ? `${c.contract_type ? `${c.contract_type} · ` : ""}${md(c.contract_on)}`
                    : c.stage === "waiting" ? `확인 ${md(c.wait_until)}`
                    : c.stage === "hold" ? `재접촉 ${md(c.hold_until)}`
                    : c.stage === "lost" ? c.lost_reason ?? "사유 없음"
                    : t.label || `기록 ${diffDays(today, c.last_activity_on)}일 전`;
                  const movable = canManage(c);
                  return (
                    <div key={c.id} className={`iq-card ${t.cls}`} draggable={movable} role="button" tabIndex={0}
                      title={movable ? "끌어서 단계 이동 · 누르면 상세" : "누르면 상세 (단계 변경은 담당자 · 관리자)"}
                      onDragStart={(e) => { e.dataTransfer.setData("text/inquiry", c.id); e.dataTransfer.effectAllowed = "move"; }}
                      onClick={() => openCard(c.id)} onKeyDown={(e) => { if (e.key === "Enter") openCard(c.id); }}>
                      <b>{c.company}</b>
                      <div className="iq-m">{[c.person, c.services.join(", ")].filter(Boolean).join(" · ") || "-"}</div>
                      <div className="iq-f">
                        {c.channel && <span className="iq-chip">{c.channel}</span>}
                        <span className={`iq-d ${isActive(c.stage) ? t.cls : ""}`}>{dd}</span>
                        <span className="iq-av" title={nameOf(c.owner)}>{nameOf(c.owner).slice(0, 1)}</span>
                        <CardActions c={c} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── 진행중으로 되돌리기 ───────────────────────────────────────────────
function ReturnControl({ c }: { c: Inquiry }) {
  const { canManage, setStage } = useIq();
  const [to, setTo] = useState<Stage>("responding");
  const [busy, setBusy] = useState(false);
  if (!canManage(c)) return null;
  return (
    <span className="iq-ret" onClick={(e) => e.stopPropagation()}>
      <select value={to} onChange={(e) => setTo(e.target.value as Stage)} aria-label="되돌릴 단계">
        {BOARD_STAGES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); await setStage(c, to); setBusy(false); }}>진행중으로 되돌리기</button>
    </span>
  );
}

// ── 대기 · 보류 · 미계약 정보 카드 ─────────────────────────────────────
function InfoCard({ c, kind, open, toggle, evs }: { c: Inquiry; kind: "waiting" | "hold" | "lost"; open: boolean; toggle: () => void; evs: IqEvent[] }) {
  const { today, settings, nameOf, openCard } = useIq();
  const t = statusOf(c, settings.sla, today);
  const until = kind === "waiting" ? c.wait_until : kind === "hold" ? c.hold_until : null;
  const left = until ? diffDays(until, today) : null;
  const memoLabel = kind === "waiting" ? "무엇을 기다리는지" : kind === "hold" ? "보류 사유" : "미계약 사유";
  const memo = kind === "waiting" ? c.wait_memo : kind === "hold" ? c.hold_memo : c.lost_memo;
  const recent = [...evs].reverse().filter((e) => e.kind !== "stage").slice(0, 2);
  const cls = kind === "lost" ? "lostc" : t.cls || (kind === "hold" ? "hold" : "");
  return (
    <div className={`iq-icard ${cls} ${open ? "open" : ""}`}>
      <div className="iq-ic-head" role="button" tabIndex={0} aria-expanded={open} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) toggle(); }}>
        <div className="iq-ttl">
          <span className="iq-chev" aria-hidden="true">▶</span>
          <b>{c.company}</b><span className="iq-who">{c.person || "담당자 미정"}</span>
          {c.channel && <span className="iq-chip">{c.channel}{c.referrer ? ` · ${c.referrer}` : ""}</span>}
          <span className="iq-dt">접수 {md(c.received_on)}</span>
        </div>
        <div className="iq-ic-right">
          {kind === "lost" ? <span className="iq-when">{md(c.stage_changed_on)} 종결</span>
            : until ? <span className={`iq-when ${left! <= 0 ? "warn" : ""}`}>{kind === "waiting" ? "확인 " : "재접촉 "}{md(until)}{left! > 0 ? ` (${left}일 후)` : left === 0 ? " (오늘)" : ` (${-left!}일 지남)`}</span>
            : <span className="iq-when warn">날짜 없음</span>}
          <ReturnControl c={c} />
          <CardActions c={c} />
        </div>
      </div>
      {open && (
        <div className="iq-ic-body" role="button" tabIndex={0} onClick={() => openCard(c.id)} onKeyDown={(e) => { if (e.key === "Enter") openCard(c.id); }}>
          <div className="iq-chips">
            <span className="iq-chip acc">{c.services.join(", ") || "서비스 미정"}</span>
            <span className="iq-chip">담당 {nameOf(c.owner)}</span>
            <span className="iq-chip">{stageName(c.stage)} {md(c.stage_changed_on)}부터</span>
            <span className="iq-hint iq-push">누르면 상세 열기</span>
          </div>
          <div className="iq-ic-grid">
            <div><label>담당자</label><div className="iq-v">{c.person || "-"}</div></div>
            <div><label>연락처</label><div className="iq-v">{c.phone || "-"}</div></div>
            <div><label>이메일</label><div className="iq-v">{c.email || "-"}</div></div>
            <div><label>예산</label><div className="iq-v">{c.budget || "미정"}</div></div>
            <div><label>업종</label><div className="iq-v">{c.industry || "-"}</div></div>
            <div><label>지역</label><div className="iq-v">{c.region || "-"}</div></div>
            <div><label>접수일</label><div className="iq-v">{md(c.received_on)} ({diffDays(today, c.received_on)}일 전)</div></div>
            <div><label>마지막 기록</label><div className="iq-v">{md(c.last_activity_on)} ({diffDays(today, c.last_activity_on)}일 전)</div></div>
            <div className="iq-w"><label>요청 내용</label><div className="iq-v">{c.summary || "-"}</div></div>
            <div className="iq-w"><label>{memoLabel}</label><div className="iq-v iq-memo">
              {kind === "lost" && <><span className="iq-chip danger">{c.lost_reason || "사유 없음"}</span> </>}{memo || (kind === "lost" ? "" : "기록 없음")}
            </div></div>
            <div className="iq-w"><label>최근 상담</label>
              {recent.length === 0 ? <div className="iq-tlm">상담 기록 없음</div>
                : recent.map((e) => <div key={e.id} className="iq-tlm">{md(e.created_at.slice(0, 10))} {KIND_NAME[e.kind]} · <span>{e.body.length > 80 ? `${e.body.slice(0, 78)}…` : e.body}</span></div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ParkedView({ kind }: { kind: "waiting" | "hold" | "lost" }) {
  const { cards, events } = useIq();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const list = cards.filter((c) => c.stage === kind).sort((a, b) =>
    kind === "waiting" ? (a.wait_until ?? "9").localeCompare(b.wait_until ?? "9")
    : kind === "hold" ? (a.hold_until ?? "9").localeCompare(b.hold_until ?? "9")
    : b.stage_changed_on.localeCompare(a.stage_changed_on));
  const byCard = useMemo(() => {
    const m = new Map<string, IqEvent[]>();
    for (const e of events) { const a = m.get(e.inquiry_id); if (a) a.push(e); else m.set(e.inquiry_id, [e]); }
    return m;
  }, [events]);
  const allOpen = list.length > 0 && list.every((c) => expanded.has(c.id));
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const reasons: Record<string, number> = {};
  if (kind === "lost") for (const c of list) reasons[c.lost_reason || "사유 없음"] = (reasons[c.lost_reason || "사유 없음"] ?? 0) + 1;

  const head = {
    waiting: { h: "대기", p: "요청 대응 · 미팅까지 마치고 상대 답을 기다리는 카드. 확인 예정일 순. 제목 줄을 누르면 펼쳐지고, 펼친 내용을 누르면 상세가 열립니다." },
    hold: { h: "보류", p: "상대 사정으로 멈춘 카드. 재접촉 예정일 순. 제목 줄을 누르면 펼쳐집니다." },
    lost: { h: "미계약", p: "" },
  }[kind];

  return (
    <section>
      <div className="iq-top">
        <div>
          <h2>{head.h}</h2>
          <p>{kind === "lost"
            ? (list.length ? <>{Object.entries(reasons).map(([r, n]) => <span key={r} className="iq-chip danger">{r} {n}</span>)} · 다시 연락이 오면 &quot;진행중으로 되돌리기&quot;로 진행합니다.</> : "미계약 카드가 없습니다.")
            : head.p}</p>
        </div>
        <button className="btn sm" onClick={() => setExpanded(allOpen ? new Set() : new Set(list.map((c) => c.id)))} disabled={!list.length}>{allOpen ? "모두 접기" : "모두 펼치기"}</button>
      </div>
      <div className="iq-rows">
        {list.length === 0 && <div className="iq-empty">{kind === "waiting" ? "대기 중인 카드가 없습니다." : kind === "hold" ? "보류 중인 카드가 없습니다." : "미계약 카드가 없습니다."}</div>}
        {list.map((c) => <InfoCard key={c.id} c={c} kind={kind} open={expanded.has(c.id)} toggle={() => toggle(c.id)} evs={byCard.get(c.id) ?? []} />)}
      </div>
    </section>
  );
}

// ── 계약 ─────────────────────────────────────────────────────────────
export function WonView() {
  const { cards, today, nameOf, openCard } = useIq();
  const won = cards.filter((c) => c.stage === "won").sort((a, b) => (b.contract_on ?? "").localeCompare(a.contract_on ?? ""));
  const thisMonth = won.filter((c) => c.contract_on?.startsWith(today.slice(0, 7))).length;
  const need = won.filter((c) => !(c.contract_on && c.contract_type && c.contract_service)).length;
  const dated = won.filter((c) => c.contract_on);
  const avg = dated.length ? Math.round(dated.reduce((a, c) => a + diffDays(c.contract_on!, c.received_on), 0) / dated.length) : 0;
  const tiles: [string, string][] = [
    ["전체 계약", `${won.length}건`], ["매월 계약", `${won.filter((c) => c.contract_type === "매월").length}건`],
    ["단기 계약", `${won.filter((c) => c.contract_type === "단기").length}건`], ["이번 달 계약", `${thisMonth}건`], ["평균 문의→계약", `${avg}일`],
  ];
  return (
    <section>
      <div className="iq-top"><div><h2>계약</h2>
        <p>{need > 0 && <span className="iq-chip danger">계약 정보 입력 필요 {need}건</span>} 계약일자 · 유형(단기/매월) · 서비스만 기록합니다. 매출은 매출 · 매입 관리툴에서 관리합니다.</p></div></div>
      <div className="iq-tiles">{tiles.map(([k, v]) => <div key={k} className="iq-tile"><div className="iq-k">{k}</div><div className="iq-v">{v}</div></div>)}</div>
      <div className="iq-tw"><table className="iq-table">
        <thead><tr><th>회사 / 담당자</th><th>계약 유형</th><th>계약 서비스</th><th>계약일자</th><th>채널</th><th>담당</th><th className="num">문의→계약</th><th></th></tr></thead>
        <tbody>
          {won.length === 0 && <tr><td colSpan={8} className="iq-empty">계약 카드가 없습니다.</td></tr>}
          {won.map((c) => (
            <tr key={c.id} onClick={() => openCard(c.id)}>
              <td><b>{c.company}</b><br /><span className="iq-hint">{c.person}</span></td>
              <td>{c.contract_type ? <span className={`iq-chip ${c.contract_type === "매월" ? "ok" : "acc"}`}>{c.contract_type}</span> : <span className="iq-chip danger">유형 없음</span>}</td>
              <td>{c.contract_service}</td><td>{md(c.contract_on)}</td><td>{c.channel}</td><td>{nameOf(c.owner)}</td>
              <td className="num">{c.contract_on ? `${diffDays(c.contract_on, c.received_on)}일` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}

// ── 전체 목록 ─────────────────────────────────────────────────────────
export function ListView() {
  const { cards, settings, staff, today, nameOf, openCard, openNew } = useIq();
  const [q, setQ] = useState(""); const [fs, setFs] = useState(""); const [fc, setFc] = useState(""); const [fo, setFo] = useState(""); const [fv, setFv] = useState("");
  const qq = q.trim().toLowerCase();
  const rows = cards.filter((c) => (!qq || [c.company, c.person, c.summary, c.referrer, c.phone, c.email].join(" ").toLowerCase().includes(qq))
    && (!fs || c.stage === fs) && (!fc || c.channel === fc) && (!fo || c.owner === fo) && (!fv || c.services.includes(fv)))
    .sort((a, b) => b.received_on.localeCompare(a.received_on) || b.no - a.no);
  return (
    <section>
      <div className="iq-top"><div><h2>전체 목록</h2><p>{rows.length}건</p></div><button className="btn primary sm" onClick={openNew}>+ 새 문의</button></div>
      <div className="iq-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회사 · 담당자 · 내용 검색" aria-label="검색" />
        <select value={fs} onChange={(e) => setFs(e.target.value)} aria-label="단계"><option value="">단계 전체</option>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select value={fc} onChange={(e) => setFc(e.target.value)} aria-label="채널"><option value="">채널 전체</option>{settings.channels.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select value={fo} onChange={(e) => setFo(e.target.value)} aria-label="담당자"><option value="">담당자 전체</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select value={fv} onChange={(e) => setFv(e.target.value)} aria-label="서비스"><option value="">서비스 전체</option>{settings.services.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </div>
      <div className="iq-tw"><table className="iq-table">
        <thead><tr><th>회사 / 담당자</th><th>단계</th><th>채널</th><th>서비스</th><th>담당</th><th>다음 액션</th><th className="num">경과</th><th>접수일</th><th></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={9} className="iq-empty">조건에 맞는 문의가 없습니다.</td></tr>}
          {rows.map((c) => {
            const t = statusOf(c, settings.sla, today);
            return (
              <tr key={c.id} onClick={() => openCard(c.id)}>
                <td><b>{c.company}</b><br /><span className="iq-hint">{c.person}</span></td>
                <td><span className={`iq-chip ${stageChip(c.stage)}`}>{stageName(c.stage)}</span></td>
                <td>{c.channel}{c.referrer && <><br /><span className="iq-hint">{c.referrer}</span></>}</td>
                <td>{c.services.join(", ")}</td>
                <td>{nameOf(c.owner)}</td>
                <td>{c.next_action_text ? <>{c.next_action_text}<br /><span className="iq-hint">{md(c.next_action_on)}</span></> : <span className="iq-hint">없음</span>}</td>
                <td className="num">{t.label ? <span className={`iq-chip ${t.cls}`}>{t.label}</span> : `${diffDays(today, c.last_activity_on)}일`}</td>
                <td>{md(c.received_on)}</td>
                <td className="r"><CardActions c={c} /></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </section>
  );
}
