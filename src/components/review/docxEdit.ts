// Word 원고(.docx) 화면 수정: 문단 글자만 고치고 나머지(서식 · 이미지 · 표)는 원본 그대로 둔다
// - 고친 글자는 문자 스타일 '검수수정' + 노란 형광 + 빨간 글씨로 표시 → 다음에 내려받는 사람도 Word 에서 어디를 고쳤는지 보인다
// - 이미지 · 링크 · 변경 추적 등이 섞인 문단은 망가지지 않도록 수정하지 않는다(읽기 전용)
import JSZip from "jszip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const EDIT_STYLE_ID = "ReviewEdit";
export const EDIT_STYLE_NAME = "검수수정";
// 미리보기(mammoth)는 ReviewFiles.tsx 의 styleMap 이 이 스타일 이름을 <mark class="rv-edit"> 로 바꾼다

export type EditPara = { idx: number; text: string; editable: boolean; heading: boolean; edited: boolean };
type Ch = { c: string; rPr: string };   // 글자 하나와 그 글자의 서식(w:rPr XML, 없으면 "")

const OK_P = new Set(["pPr", "r", "proofErr", "bookmarkStart", "bookmarkEnd"]);
const OK_R = new Set(["rPr", "t", "tab", "br", "lastRenderedPageBreak"]);
const ser = new XMLSerializer();

function paragraphs(doc: Document) {
  // 그림 · 대체 내용 안의 문단은 건너뛴다 (같은 글이 두 번 잡히고, 구조가 복잡하다)
  return [...doc.getElementsByTagNameNS(W, "p")].filter((p) => {
    for (let n = p.parentElement; n; n = n.parentElement) if (["drawing", "pict", "AlternateContent", "txbxContent", "object"].includes(n.localName)) return false;
    return true;
  });
}

function chars(p: Element): Ch[] | null {
  const out: Ch[] = [];
  for (const k of [...p.children]) {
    if (!OK_P.has(k.localName) || k.namespaceURI !== W) return null;
    if (k.localName !== "r") continue;
    const rPrEl = [...k.children].find((x) => x.localName === "rPr");
    const rPr = rPrEl ? ser.serializeToString(rPrEl) : "";
    for (const x of [...k.children]) {
      if (!OK_R.has(x.localName)) return null;
      if (x.localName === "t") for (const c of x.textContent ?? "") out.push({ c, rPr });
      else if (x.localName === "tab") out.push({ c: "\t", rPr });
      else if (x.localName === "br") { if (x.getAttributeNS(W, "type") && x.getAttributeNS(W, "type") !== "textWrapping") return null; out.push({ c: "\n", rPr }); }
    }
  }
  return out;
}

const plain = (p: Element) => [...p.getElementsByTagNameNS(W, "t")].map((t) => t.textContent ?? "").join("");
// 제목 문단: 스타일 이름이 heading · title · 제목 (한국어 Word 는 스타일 ID 가 "1" 처럼 숫자라 styles.xml 의 이름으로 본다)
const HEAD = /heading|title|제목/i;
const isHeading = (p: Element, names: Map<string, string>) => {
  const id = p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") ?? "";
  return !!id && (HEAD.test(id) || HEAD.test(names.get(id) ?? ""));
};
async function styleNames(zip: JSZip) {
  const xml = await zip.file("word/styles.xml")?.async("string");
  const names = new Map<string, string>();
  if (!xml) return names;
  const d = new DOMParser().parseFromString(xml, "application/xml");
  for (const st of [...d.getElementsByTagNameNS(W, "style")]) {
    const n = [...st.children].find((x) => x.localName === "name")?.getAttributeNS(W, "val");
    if (n) names.set(st.getAttributeNS(W, "styleId") ?? "", n);
  }
  return names;
}

export async function loadDocx(buf: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("document.xml 없음");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("원고를 읽지 못했습니다");
  const names = await styleNames(zip);
  const paras: EditPara[] = paragraphs(doc).map((p, idx) => {
    const cs = chars(p);
    return { idx, text: cs ? cs.map((x) => x.c).join("") : plain(p), editable: !!cs, heading: isHeading(p, names), edited: !!cs?.some((x) => x.rPr.includes(EDIT_STYLE_ID)) };
  });
  return { zip, doc, paras };
}

// 단어 단위로 나눈다 (공백 · 문장부호는 따로) → 고친 단어는 통째로 표시된다
const tokens = (s: string) => s.match(/\s+|[\p{L}\p{N}]+|[^]/gu) ?? [];

// 변경 구간 찾기: 앞뒤 같은 부분을 떼고, 가운데는 최장 공통 부분(LCS) — 너무 길면 가운데 전체를 바뀐 것으로
function diff(a: string[], b: string[]): ("keep" | "ins" | "del")[] {
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const A = a.slice(s, a.length - e), B = b.slice(s, b.length - e);
  const ops: ("keep" | "ins" | "del")[] = Array(s).fill("keep");
  if (A.length * B.length > 4_000_000) { ops.push(...Array(A.length).fill("del"), ...Array(B.length).fill("ins")); }
  else {
    const n = A.length, m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { ops.push("keep"); i++; j++; }
      else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) { ops.push("ins"); j++; }
      else { ops.push("del"); i++; }
    }
  }
  ops.push(...Array(e).fill("keep"));
  return ops;
}

// w:rPr 안 요소 순서 (Word 는 순서가 틀리면 파일이 손상됐다고 본다)
const RPR_ORDER = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"];
function markRPr(rPr: string, doc: Document): string {
  const el = rPr ? (new DOMParser().parseFromString(rPr, "application/xml").documentElement) : doc.createElementNS(W, "w:rPr");
  for (const k of [...el.children]) if (["rStyle", "color", "highlight"].includes(k.localName)) el.removeChild(k);
  const add = (name: string, val: string) => { const x = el.ownerDocument.createElementNS(W, `w:${name}`); x.setAttributeNS(W, "w:val", val); return x; };
  const news = [add("rStyle", EDIT_STYLE_ID), add("color", "C00000"), add("highlight", "yellow")];
  for (const n of news) {
    const pos = RPR_ORDER.indexOf(n.localName);
    const before = [...el.children].find((k) => RPR_ORDER.indexOf(k.localName) > pos);
    el.insertBefore(n, before ?? null);
  }
  return ser.serializeToString(el);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function runsXml(cs: Ch[]) {
  let out = "";
  for (let i = 0; i < cs.length;) {
    let j = i; while (j < cs.length && cs[j].rPr === cs[i].rPr) j++;
    let body = "";
    for (const part of cs.slice(i, j).map((x) => x.c).join("").split(/(\t|\n)/)) {
      if (part === "\t") body += "<w:tab/>"; else if (part === "\n") body += "<w:br/>"; else if (part) body += `<w:t xml:space="preserve">${esc(part)}</w:t>`;
    }
    out += `<w:r>${cs[i].rPr}${body}</w:r>`;
    i = j;
  }
  return out;
}

function rebuild(p: Element, next: string, doc: Document) {
  const old = chars(p)!;
  const a = tokens(old.map((x) => x.c).join("")), b = tokens(next);
  const ops = diff(a, b);
  const out: Ch[] = [];
  let ti = 0, tj = 0, ci = 0, lastRPr = old[0]?.rPr ?? "";   // ci: 원래 글자 위치
  for (const op of ops) {
    if (op === "keep") { const n = [...a[ti]].length; for (let k = 0; k < n; k++) out.push(old[ci + k]); lastRPr = old[ci + n - 1].rPr; ci += n; ti++; tj++; }
    else if (op === "del") { const n = [...a[ti]].length; lastRPr = old[ci + n - 1].rPr; ci += n; ti++; }
    else { const m = markRPr(lastRPr, doc); for (const c of b[tj]) out.push({ c, rPr: m }); tj++; }
  }
  // 기존 run · proofErr 는 지우고(책갈피 · 문단 서식은 남김), 새 run 을 문단 끝에 넣는다
  for (const k of [...p.children]) if (k.localName === "r" || k.localName === "proofErr") p.removeChild(k);
  const frag = new DOMParser().parseFromString(`<x xmlns:w="${W}">${runsXml(out)}</x>`, "application/xml").documentElement;
  for (const r of [...frag.children]) p.appendChild(doc.importNode(r, true));
}

async function ensureStyle(zip: JSZip) {
  const f = zip.file("word/styles.xml");
  if (!f) return;
  const xml = await f.async("string");
  if (xml.includes(`w:styleId="${EDIT_STYLE_ID}"`)) return;
  const style = `<w:style w:type="character" w:customStyle="1" w:styleId="${EDIT_STYLE_ID}"><w:name w:val="${EDIT_STYLE_NAME}"/><w:rPr><w:color w:val="C00000"/><w:highlight w:val="yellow"/></w:rPr></w:style>`;
  zip.file("word/styles.xml", xml.replace(/<\/w:styles>\s*$/, `${style}</w:styles>`));
}

// edits: 문단 번호 → 새 글. 바뀐 문단만 다시 쓴다
export async function saveDocx(loaded: Awaited<ReturnType<typeof loadDocx>>, edits: Map<number, string>): Promise<Blob | null> {
  const { zip, doc, paras } = loaded;
  const ps = paragraphs(doc);
  let changed = 0;
  for (const [idx, text] of edits) {
    const p = ps[idx];
    if (!p || !paras[idx]?.editable || paras[idx].text === text) continue;
    rebuild(p, text, doc);
    changed++;
  }
  if (!changed) return null;
  zip.file("word/document.xml", ser.serializeToString(doc));
  await ensureStyle(zip);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}
