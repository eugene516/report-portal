"use client";
// 문의 상세 패널 (오른쪽에서 밀려 나옴)
// - 단계 버튼 · 계약/미계약/대기/보류 정보: 담당자 · 관리자만 (담당 미정 카드는 누구나)
// - 다음 액션 · 상담 이력 · 기본 정보: 직원 누구나. 입력칸은 칸을 벗어날 때 저장된다
// - AI 도우미: 다음 액션 추천 · 후속 메일/카톡 초안(자동 발송 없음) · 미팅 녹취 요약
import { useState } from "react";
import { toast, toastError } from "@/components/ui";
import { useIq } from "./ctx";
import { callAi } from "./ai";
import { BOARD_STAGES, code, KIND_ICON, KIND_NAME, md, NOTE_KINDS, STAGES, statusOf,
  type EventKind, type Inquiry } from "./model";

type TextField = "company" | "person" | "phone" | "email" | "referrer" | "budget" | "industry" | "region" | "summary"
  | "next_action_text" | "contract_service" | "lost_memo" | "wait_memo" | "hold_memo";
type DateField = "next_action_on" | "contract_on" | "wait_until" | "hold_until";
const kstTime = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(5, 16).replace("-", ".").replace("T", " ");

export default function DetailPanel({ c, onClose }: { c: Inquiry; onClose: () => void }) {
  const iq = useIq();
  const { settings, staff, today, meId, isAdmin, nameOf, patch, setStage, addEvent, removeEvent, removeCard } = iq;
  const manage = iq.canManage(c);
  const t = statusOf(c, settings.sla, today);
  const evs = iq.events.filter((e) => e.inquiry_id === c.id);

  // 칸을 벗어날 때 바뀐 경우에만 저장
  const saveText = (f: TextField, raw: string, required = false) => {
    const v = raw.trim() || null;
    if (required && !v) { toastError("회사명은 비울 수 없습니다."); return false; }
    if (v !== (c[f] ?? null)) patch(c, { [f]: v } as Partial<Inquiry>);
    return true;
  };
  const saveDate = (f: DateField, v: string) => { if ((v || null) !== (c[f] ?? null)) patch(c, { [f]: v || null } as Partial<Inquiry>); };
  // 입력칸 그리기 (컴포넌트가 아니라 함수로 불러야 다시 그릴 때 입력 중인 칸이 초기화되지 않는다)
  const txt = (f: TextField, label: string, o: { wide?: boolean; area?: boolean; ph?: string; locked?: boolean; required?: boolean } = {}) => (
    <div className={`iq-fld ${o.wide ? "iq-w" : ""}`}>
      <label>{label}</label>
      {o.area
        ? <textarea defaultValue={c[f] ?? ""} placeholder={o.ph} disabled={o.locked} maxLength={4000} onBlur={(e) => saveText(f, e.target.value)} />
        : <input defaultValue={c[f] ?? ""} placeholder={o.ph} disabled={o.locked} maxLength={300}
            onBlur={(e) => { if (!saveText(f, e.target.value, o.required)) e.target.value = c[f] ?? ""; }} />}
    </div>
  );
  const dt = (f: DateField, label: string, locked?: boolean) => (
    <div className="iq-fld"><label>{label}</label>
      <input type="date" defaultValue={c[f] ?? ""} disabled={locked}
        onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) saveDate(f, e.target.value); }}
        onBlur={(e) => saveDate(f, e.target.value)} />
    </div>
  );

  // ── AI ─────────────────────────────────────────
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [nextAi, setNextAi] = useState<{ text: string; date: string; why: string } | null>(null);
  const [draft, setDraft] = useState<{ kind: "mail" | "kakao"; text: string } | null>(null);
  const [showT, setShowT] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sum, setSum] = useState<string | null>(null);

  async function runNext() {
    setAiBusy("next");
    const r = await callAi<{ next: { text: string; date: string; why: string } }>({ action: "next", inquiryId: c.id });
    setAiBusy(null);
    if (!r.ok) return toastError(r.error);
    setNextAi(r.data.next);
  }
  async function runDraft(kind: "mail" | "kakao") {
    setAiBusy(kind); setShowT(false);
    const r = await callAi<{ draft: string }>({ action: "draft", inquiryId: c.id, kind });
    setAiBusy(null);
    if (!r.ok) return toastError(r.error);
    setDraft({ kind, text: r.data.draft });
  }
  async function runSummary() {
    if (!transcript.trim()) return toastError("녹취 텍스트를 붙여넣으세요.");
    setAiBusy("sum");
    const r = await callAi<{ summary: string }>({ action: "summarize", inquiryId: c.id, transcript });
    setAiBusy(null);
    if (!r.ok) return toastError(r.error);
    setSum(r.data.summary);
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast("복사했습니다."); } catch { toastError("복사하지 못했습니다. 글을 직접 선택해 복사하세요."); }
  }

  // ── 상담 기록 ───────────────────────────────────
  const [noteKind, setNoteKind] = useState<EventKind>("memo");
  const [note, setNote] = useState("");
  async function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    if (await addEvent(c, noteKind, note)) setNote("");
  }

  return (
    <>
      <div className="iq-scrim" onClick={onClose} />
      <aside className="iq-panel" role="dialog" aria-modal="true" aria-label={`${c.company} 문의 상세`}>
        <div className="iq-ph">
          <div>
            <h2>{c.company}</h2>
            <p>{[c.person, c.channel && `${c.channel}${c.referrer ? ` · ${c.referrer}` : ""}`, `접수 ${md(c.received_on)}`, code(c.no)].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="iq-row">
            {iq.canDelete(c) && <button className="btn sm iq-danger" onClick={async () => { if (await removeCard(c)) onClose(); }}>삭제</button>}
            <button className="btn sm" onClick={onClose}>닫기</button>
          </div>
        </div>

        <div className="iq-pb">
          {/* 단계 */}
          <div>
            <div className="iq-fld"><label>단계 {!manage && <span className="iq-hint">· 담당자({nameOf(c.owner)}) 또는 관리자만 바꿀 수 있습니다</span>}</label></div>
            <div className="iq-stage-bar">
              {BOARD_STAGES.map((s) => <button key={s.id} className={c.stage === s.id ? "on" : ""} disabled={!manage} onClick={() => setStage(c, s.id)}>{s.name}</button>)}
              <span className="iq-break" />
              {STAGES.filter((s) => !s.sla).map((s) => (
                <button key={s.id} className={`${s.cls} ${c.stage === s.id ? "on" : ""}`} disabled={!manage} title="진행중 보드에서 빠져 해당 메뉴로 이동" onClick={() => setStage(c, s.id)}>{s.name} ↗</button>
              ))}
            </div>
            {t.label && <p className="iq-hint iq-mt-xs">상태: <span className={`iq-chip ${t.cls}`}>{t.label}</span></p>}
          </div>

          {c.stage === "won" && (
            <div className="iq-box ok" key={`won-${c.stage_changed_on}`}>
              <h3>계약 정보 <span className="iq-hint">매출 · 매입 관리툴에는 따로 등록</span></h3>
              <div className="iq-grid2">
                {dt("contract_on", "계약일자", !manage)}
                <div className="iq-fld"><label>계약 유형</label>
                  <select value={c.contract_type ?? ""} disabled={!manage} onChange={(e) => patch(c, { contract_type: (e.target.value || null) as Inquiry["contract_type"] })}>
                    <option value="">선택</option><option value="매월">매월</option><option value="단기">단기</option>
                  </select>
                </div>
                {txt("contract_service", "계약 서비스 · 패키지", { wide: true, ph: "예: 병원 마케팅 PRO / 홈페이지 제작", locked: !manage })}
              </div>
            </div>
          )}
          {c.stage === "lost" && (
            <div className="iq-box bad" key={`lost-${c.stage_changed_on}`}>
              <h3>미계약 사유</h3>
              <div className="iq-grid2">
                <div className="iq-fld"><label>사유</label>
                  <select value={c.lost_reason ?? ""} disabled={!manage} onChange={(e) => patch(c, { lost_reason: e.target.value || null })}>
                    <option value="">선택</option>
                    {[...settings.lost_reasons, ...(c.lost_reason && !settings.lost_reasons.includes(c.lost_reason) ? [c.lost_reason] : [])].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                {txt("lost_memo", "메모", { wide: true, area: true, locked: !manage })}
              </div>
            </div>
          )}
          {c.stage === "waiting" && (
            <div className="iq-box acc" key={`wait-${c.stage_changed_on}`}>
              <h3>대기 <span className="iq-hint">상대 답을 기다리는 중</span></h3>
              <div className="iq-grid2">
                {dt("wait_until", "확인 예정일", !manage)}
                {txt("wait_memo", "무엇을 기다리는지", { wide: true, area: true, locked: !manage })}
              </div>
            </div>
          )}
          {c.stage === "hold" && (
            <div className="iq-box hold" key={`hold-${c.stage_changed_on}`}>
              <h3>보류</h3>
              <div className="iq-grid2">
                {dt("hold_until", "재접촉 예정일", !manage)}
                {txt("hold_memo", "보류 사유 · 메모", { wide: true, area: true, locked: !manage })}
              </div>
            </div>
          )}

          {/* 다음 액션 */}
          <div className="iq-box acc" key={`next-${c.next_action_text}-${c.next_action_on}`}>
            <h3>다음 액션 <button className="btn sm iq-ai" onClick={runNext} disabled={aiBusy !== null}>{aiBusy === "next" ? "추천 중…" : "AI 추천"}</button></h3>
            <div className="iq-grid2">
              {txt("next_action_text", "할 일", { ph: "예: 견적 발송 후 확인 전화" })}
              {dt("next_action_on", "날짜")}
            </div>
            {nextAi && (
              <div className="iq-aiout">
                <b>{nextAi.text || "추천할 액션이 없습니다"}</b>{nextAi.text && ` · ${nextAi.date === today ? "오늘" : md(nextAi.date)}`}
                <div className="iq-hint">{nextAi.why}</div>
                {nextAi.text && (
                  <div className="iq-row iq-mt-xs">
                    <button className="btn sm primary" onClick={async () => { if (await patch(c, { next_action_text: nextAi.text, next_action_on: nextAi.date })) { setNextAi(null); toast("다음 액션을 넣었습니다."); } }}>이대로 넣기</button>
                    <button className="btn sm" onClick={() => setNextAi(null)}>닫기</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 상담 이력 */}
          <div className="iq-box">
            <h3>상담 이력 <span className="iq-hint">{evs.length}건 · 마지막 기록 {md(c.last_activity_on)}</span></h3>
            <form className="iq-addnote" onSubmit={submitNote}>
              <select value={noteKind} onChange={(e) => setNoteKind(e.target.value as EventKind)} aria-label="기록 종류">
                {NOTE_KINDS.map((k) => <option key={k} value={k}>{KIND_NAME[k]}</option>)}
              </select>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={8000} placeholder="상담 내용 기록 후 엔터" aria-label="상담 내용" />
              <button className="btn sm primary" disabled={!note.trim()}>기록</button>
            </form>
            <div className="iq-tl">
              {[...evs].reverse().map((e) => (
                <div key={e.id} className="iq-e">
                  <div className={`iq-ic ${e.kind === "ai" ? "ai" : ""}`} aria-hidden="true">{KIND_ICON[e.kind] ?? "·"}</div>
                  <div>
                    <div className="iq-h">
                      {kstTime(e.created_at)} · {KIND_NAME[e.kind] ?? e.kind} · {nameOf(e.author)}
                      {e.kind !== "stage" && (isAdmin || e.author === meId) && <button className="iq-x" onClick={() => removeEvent(e)} aria-label="기록 삭제" title="삭제">✕</button>}
                    </div>
                    <div className="iq-xt">{e.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI 도우미 */}
          <div className="iq-box">
            <h3>AI 도우미</h3>
            <div className="iq-row">
              <button className="btn sm iq-ai" disabled={aiBusy !== null} onClick={() => runDraft("mail")}>{aiBusy === "mail" ? "쓰는 중…" : "후속 메일 초안"}</button>
              <button className="btn sm iq-ai" disabled={aiBusy !== null} onClick={() => runDraft("kakao")}>{aiBusy === "kakao" ? "쓰는 중…" : "후속 카톡 초안"}</button>
              <button className="btn sm iq-ai" disabled={aiBusy !== null} onClick={() => { setShowT(!showT); setDraft(null); }}>미팅 녹취 요약</button>
            </div>
            {draft && (
              <>
                <textarea className="iq-aiout iq-draft" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} aria-label="초안" />
                <div className="iq-row iq-mt-xs">
                  <button className="btn sm" onClick={() => copy(draft.text)}>복사</button>
                  <button className="btn sm primary" onClick={async () => {
                    if (await addEvent(c, draft.kind, `${draft.kind === "mail" ? "메일" : "카톡"} 발송 (AI 초안)\n${draft.text}`)) { setDraft(null); toast("기록했습니다."); }
                  }}>보낸 것으로 기록</button>
                </div>
                <p className="iq-hint iq-mt-xs">자동 발송은 하지 않습니다. 고쳐서 복사해 보내고 &apos;보낸 것으로 기록&apos;을 누르세요.</p>
              </>
            )}
            {showT && (
              <>
                <div className="iq-fld iq-mt-xs"><label>녹취 텍스트 붙여넣기</label>
                  <textarea className="iq-tall" value={transcript} onChange={(e) => setTranscript(e.target.value)} maxLength={60000} placeholder="클로바노트 등에서 복사한 녹취 전문" />
                </div>
                <div className="iq-row iq-mt-xs"><button className="btn sm iq-ai" disabled={aiBusy !== null} onClick={runSummary}>{aiBusy === "sum" ? "요약 중…" : "요약하기"}</button></div>
                {sum && (
                  <>
                    <div className="iq-aiout">{sum}</div>
                    <div className="iq-row iq-mt-xs">
                      <button className="btn sm primary" onClick={async () => { if (await addEvent(c, "meeting", `[녹취 요약]\n${sum}`)) { setSum(null); setTranscript(""); setShowT(false); toast("상담 이력에 저장했습니다."); } }}>상담 이력에 저장</button>
                      <button className="btn sm" onClick={() => copy(sum)}>복사</button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* 기본 정보 */}
          <div className="iq-box">
            <h3>기본 정보</h3>
            <div className="iq-grid2">
              {txt("company", "회사 · 병원명", { required: true })}
              {txt("person", "담당자 · 직책")}
              {txt("phone", "연락처")}
              {txt("email", "이메일")}
              <div className="iq-fld"><label>채널</label>
                <select value={c.channel ?? ""} onChange={(e) => patch(c, { channel: e.target.value || null })}>
                  <option value="">선택 안 함</option>
                  {[...settings.channels, ...(c.channel && !settings.channels.includes(c.channel) ? [c.channel] : [])].map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
              {txt("referrer", "소개자 (지인 · 소개 · BNI일 때)")}
              <div className="iq-fld"><label>담당자(우리)</label>
                <select value={c.owner ?? ""} disabled={!manage} onChange={(e) => patch(c, { owner: e.target.value || null })} title={manage ? "" : "담당자 또는 관리자만 바꿀 수 있습니다"}>
                  <option value="">미정</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {txt("budget", "예산")}
              {txt("industry", "업종")}
              {txt("region", "지역")}
              <div className="iq-fld iq-w"><label>관심 서비스</label>
                <div className="iq-taglist">
                  {[...settings.services, ...c.services.filter((s) => !settings.services.includes(s))].map((s) => (
                    <label key={s} className="iq-tag iq-check">
                      <input type="checkbox" checked={c.services.includes(s)}
                        onChange={(e) => patch(c, { services: e.target.checked ? [...c.services, s] : c.services.filter((x) => x !== s) })} />{s}
                    </label>
                  ))}
                </div>
              </div>
              {txt("summary", "요청 내용 요약", { wide: true, area: true })}
              {c.raw && <div className="iq-fld iq-w"><label>문의 원문</label><textarea readOnly className="iq-raw" value={c.raw} /></div>}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
