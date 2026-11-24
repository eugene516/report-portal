// Word 원고(.docx) 화면 수정: 문단 글자 · 원고 안 이미지만 고치고 나머지(서식 · 표 · 링크 주소)는 원본 그대로 둔다
// - 고친 글자는 문자 스타일 '검수수정' + 노란 형광 + 빨간 글씨로 표시 → 다음에 내려받는 사람도 Word 에서 어디를 고쳤는지 보인다
// - 이미지는 교체 · 삭제할 수 있고, 그 자리에 형광 표시된 "[이미지 교체]" · "[이미지 삭제]" 글자를 남긴다
// - 링크 안 글자도 고칠 수 있다 (링크는 유지). 필드 · 변경 추적 · 각주 등이 섞인 문단은 망가지지 않도록 수정하지 않는다(읽기 전용)
import JSZip from "jszip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
export const EDIT_STYLE_ID = "ReviewEdit";
export const EDIT_STYLE_NAME = "검수수정";
// 미리보기(mammoth)는 ReviewFiles.tsx 의 styleMap 이 이 스타일 이름을 <mark class="rv-edit"> 로 바꾼다
const MARK_REPLACED = "[이미지 교체]";
const MARK_DELETED = "[이미지 삭제]";

// 문단 = 글 구간(segs)과 그 사이 그림(objs). segs.length === objs.length + 1
export type EditObj = { kind: "image" | "other"; src: string | null };
export type EditPara = { idx: number; text: string; editable: boolean; heading: boolean; edited: boolean; segs: string[]; objs: EditObj[] };
export type ObjAct = "delete" | File | null;   // null = 그대로
export type ParaChange = { segs: string[]; objs: ObjAct[] };

type Ch = { t: "c"; c: string; rPr: string; wrap: string };          // 글자 하나 · 서식(w:rPr XML) · 감싼 링크(w:hyperlink 빈 껍데기 XML, 없으면 "")
type Obj = { t: "o"; xml: string; wrap: string; embed: string | null }; // 그림이 든 run 통째
type Atom = Ch | Obj;

const P_SKIP = new Set(["pPr", "proofErr", "bookmarkStart", "bookmarkEnd", "permStart", "permEnd"]);
const OK_R = new Set(["rPr", "t", "tab", "br", "lastRenderedPageBreak"]);
const OBJ = new Set(["drawing", "pict", "object", "AlternateContent"]);
const ser = new XMLSerializer();
const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");

function paragraphs(doc: Document) {
  // 그림 · 대체 내용 안의 문단은 건너뛴다 (같은 글이 두 번 잡히고, 구조가 복잡하다)
  return [...doc.getElementsByTagNameNS(W, "p")].filter((p) => {
    for (let n = p.parentElement; n; n = n.parentElement) if (["drawing", "pict", "AlternateContent", "txbxContent", "object"].includes(n.localName)) return false;
    return true;
  });
}

const blipId = (el: Element) => {
  const b = [...el.getElementsByTagName("*")].find((x) => x.localName === "blip");
  return b?.getAttributeNS(R, "embed") || null;
};

// 문단을 글자 · 그림 단위로 푼다. 다룰 수 없는 요소가 있으면 null(읽기 전용)
function atoms(p: Element): Atom[] | null {
  const out: Atom[] = [];
  const run = (r: Element, wrap: string) => {
    const kids = [...r.children];
    const rPrEl = kids.find((x) => x.localName === "rPr");
    const rPr = rPrEl ? ser.serializeToString(rPrEl) : "";
    if (kids.some((x) => OBJ.has(x.localName))) {
      if (kids.some((x) => !OBJ.has(x.localName) && x.localName !== "rPr" && x.localName !== "lastRenderedPageBreak")) return false;
      out.push({ t: "o", xml: ser.serializeToString(r), wrap, embed: blipId(r) });
      return true;
    }
    for (const x of kids) {
      if (!OK_R.has(x.localName)) return false;
      if (x.localName === "t") for (const c of x.textContent ?? "") out.push({ t: "c", c, rPr, wrap });
      else if (x.localName === "tab") out.push({ t: "c", c: "\t", rPr, wrap });
      else if (x.localName === "br") { const ty = x.getAttributeNS(W, "type"); if (ty && ty !== "textWrapping") return false; out.push({ t: "c", c: "\n", rPr, wrap }); }
    }
    return true;
  };
  for (const k of [...p.children]) {
    if (k.namespaceURI !== W) return null;
    if (P_SKIP.has(k.localName)) continue;
    if (k.localName === "r") { if (!run(k, "")) return null; }
    else if (k.localName === "hyperlink") {
      const wrap = ser.serializeToString(k.cloneNode(false));
      for (const r of [...k.children]) {
        if (r.localName === "r") { if (!run(r, wrap)) return null; }
        else if (!P_SKIP.has(r.localName)) return null;
      }
    } else return null;
  }
  return out;
}

// 그림 사이사이 글 구간으로 나눈다
function split(list: Atom[]) {
  const segs: Ch[][] = [[]];
  const objs: Obj[] = [];
  for (const a of list) {
    if (a.t === "o") { objs.push(a); segs.push([]); }
    else segs[segs.length - 1].push(a);
  }
  return { segs, objs };
}

const plain = (p: Element) => [...p.getElementsByTagNameNS(W, "t")].map((t) => t.textContent ?? "").join("");
// 제목 문단: 스타일 이름이 heading · title · 제목 (한국어 Word 는 스타일 ID 가 "1" 처럼 숫자라 styles.xml 의 이름으로 본다)
const HEAD = /heading|title|제목/i;
const isHeading = (p: Element, names: Map<string, string>) => {
  const id = p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") ?? "";
  return !!id && (HEAD.test(id) || HEAD.test(names.get(id) ?? ""));
};
async function styleNames(zip: JSZip) {
  const s = await zip.file("word/styles.xml")?.async("string");
  const names = new Map<string, string>();
  if (!s) return names;
  for (const st of [...xml(s).getElementsByTagNameNS(W, "style")]) {
    const n = [...st.children].find((x) => x.localName === "name")?.getAttributeNS(W, "val");
    if (n) names.set(st.getAttributeNS(W, "styleId") ?? "", n);
  }
  return names;
}

const IMG_TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };
const RELS = "word/_rels/document.xml.rels";

export async function loadDocx(buf: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buf);
  const s = await zip.file("word/document.xml")?.async("string");
  if (!s) throw new Error("document.xml 없음");
  const doc = xml(s);
  if (doc.getElementsByTagName("parsererror").length) throw new Error("원고를 읽지 못했습니다");
  const names = await styleNames(zip);
  const relsDoc = xml((await zip.file(RELS)?.async("string")) ?? `<Relationships xmlns="${PKG}"/>`);
  const target = new Map([...relsDoc.getElementsByTagNameNS(PKG, "Relationship")].filter((r) => r.getAttribute("TargetMode") !== "External").map((r) => [r.getAttribute("Id") ?? "", r.getAttribute("Target") ?? ""]));
  // 원고 안 이미지 → 화면에 보일 주소 (같은 이미지는 한 번만)
  const urls: string[] = [];
  const srcCache = new Map<string, Promise<string | null>>();
  const src = (embed: string | null) => {
    if (!embed) return Promise.resolve(null);
    let p = srcCache.get(embed);
    if (!p) {
      p = (async () => {
        const t = target.get(embed);
        const path = t ? (t.startsWith("/") ? t.slice(1) : `word/${t}`).replace(/[^/]+\/\.\.\//g, "") : "";
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        const f = path && IMG_TYPE[ext] ? zip.file(path) : null;   // emf · wmf 등은 브라우저가 못 그린다
        if (!f) return null;
        const u = URL.createObjectURL(new Blob([await f.async("arraybuffer")], { type: IMG_TYPE[ext] }));
        urls.push(u);
        return u;
      })();
      srcCache.set(embed, p);
    }
    return p;
  };
  const paras: EditPara[] = await Promise.all(paragraphs(doc).map(async (p, idx) => {
    const list = atoms(p);
    if (!list) return { idx, text: plain(p), editable: false, heading: isHeading(p, names), edited: false, segs: [plain(p)], objs: [] };
    const { segs, objs } = split(list);
    return {
      idx, editable: true, heading: isHeading(p, names),
      text: segs.map((x) => x.map((c) => c.c).join("")).join(""),
      edited: list.some((a) => a.t === "c" && a.rPr.includes(EDIT_STYLE_ID)),
      segs: segs.map((x) => x.map((c) => c.c).join("")),
      objs: await Promise.all(objs.map(async (o) => ({ kind: o.embed ? "image" as const : "other" as const, src: await src(o.embed) }))),
    };
  }));
  return { zip, doc, paras, dispose: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
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
  const el = rPr ? xml(rPr).documentElement : doc.createElementNS(W, "w:rPr");
  for (const k of [...el.children]) if (["rStyle", "color", "highlight"].includes(k.localName)) el.removeChild(k);
  const add = (name: string, val: string) => { const x = el.ownerDocument.createElementNS(W, `w:${name}`); x.setAttributeNS(W, "w:val", val); return x; };
  for (const n of [add("rStyle", EDIT_STYLE_ID), add("color", "C00000"), add("highlight", "yellow")]) {
    const pos = RPR_ORDER.indexOf(n.localName);
    const before = [...el.children].find((k) => RPR_ORDER.indexOf(k.localName) > pos);
    el.insertBefore(n, before ?? null);
  }
  return ser.serializeToString(el);
}

// 글 구간 하나: 원래 글자와 새 글을 비교해 유지 · 삭제 · 추가(형광 표시)
function diffSeg(old: Ch[], next: string, base: string, doc: Document): Ch[] {
  const a = tokens(old.map((x) => x.c).join("")), b = tokens(next);
  const out: Ch[] = [];
  let ti = 0, tj = 0, ci = 0, lastRPr = old[0]?.rPr ?? base, lastWrap = "";
  for (const op of diff(a, b)) {
    if (op === "keep") { const n = [...a[ti]].length; for (let k = 0; k < n; k++) out.push(old[ci + k]); lastRPr = old[ci + n - 1].rPr; lastWrap = old[ci + n - 1].wrap; ci += n; ti++; tj++; }
    else if (op === "del") { const n = [...a[ti]].length; lastRPr = old[ci + n - 1].rPr; lastWrap = old[ci + n - 1].wrap; ci += n; ti++; }
    else {
      // 링크 글자 사이에 넣은 글만 링크 안으로 (링크 앞뒤에 붙인 글은 링크 밖)
      const wrap = lastWrap && old[ci]?.wrap === lastWrap ? lastWrap : "";
      const m = markRPr(lastRPr, doc);
      for (const c of b[tj]) out.push({ t: "c", c, rPr: m, wrap });
      tj++;
    }
  }
  return out;
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

// 새 이미지를 원고 패키지에 넣는다 (media 파일 · 관계 · 형식). 반환: 관계 Id 와 원래 비율
type Pkg = { zip: JSZip; rels: Document; types: Document; n: number };
async function addImage(pkg: Pkg, file: File) {
  let ext = (file.name.split(".").pop() ?? "").toLowerCase();
  let data: Blob = file;
  const bmp = await createImageBitmap(file);
  const w = bmp.width, h = bmp.height;
  if (!["png", "jpg", "jpeg", "gif"].includes(ext)) {
    // Word 가 못 여는 형식(webp 등)은 PNG 로 바꿔 넣는다
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    data = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("PNG 변환 실패"))), "image/png"));
    ext = "png";
  }
  bmp.close();
  const name = `rv_${Date.now().toString(36)}_${pkg.n++}.${ext}`;
  pkg.zip.file(`word/media/${name}`, data);
  const root = pkg.rels.documentElement;
  let id = ""; for (let k = 1; !id || root.querySelector(`[Id="${id}"]`); k++) id = `rIdRv${k}`;
  const rel = pkg.rels.createElementNS(PKG, "Relationship");
  rel.setAttribute("Id", id); rel.setAttribute("Type", IMAGE_REL); rel.setAttribute("Target", `media/${name}`);
  root.appendChild(rel);
  const tr = pkg.types.documentElement;
  if (![...tr.getElementsByTagNameNS(CT, "Default")].some((d) => d.getAttribute("Extension")?.toLowerCase() === ext)) {
    const d = pkg.types.createElementNS(CT, "Default");
    d.setAttribute("Extension", ext); d.setAttribute("ContentType", ext === "jpg" ? "image/jpeg" : IMG_TYPE[ext]);
    tr.insertBefore(d, tr.firstChild);
  }
  return { id, w, h };
}

// 그림 run 의 이미지 연결을 새 이미지로 바꾸고, 가로 크기는 그대로 두고 세로를 새 비율에 맞춘다
function swapImage(objXml: string, oldId: string, img: { id: string; w: number; h: number }) {
  const d = xml(objXml);
  for (const el of [d.documentElement, ...d.documentElement.getElementsByTagName("*")]) {
    for (const at of [...el.attributes]) if (at.namespaceURI === R && at.value === oldId) el.setAttributeNS(R, at.name, img.id);
    if ((el.localName === "extent" || (el.localName === "ext" && el.parentElement?.localName === "xfrm")) && el.getAttribute("cx")) {
      const cx = Number(el.getAttribute("cx"));
      if (cx > 0) el.setAttribute("cy", String(Math.round((cx * img.h) / img.w)));
    }
  }
  return ser.serializeToString(d.documentElement);
}

async function rebuild(p: Element, change: ParaChange, doc: Document, pkg: Pkg) {
  const { segs, objs } = split(atoms(p)!);
  const base = segs.flat()[0]?.rPr ?? "";
  const out: Atom[] = [];
  for (let i = 0; i < segs.length; i++) {
    out.push(...diffSeg(segs[i], change.segs[i] ?? "", base, doc));
    const o = objs[i];
    if (!o) continue;
    const act = change.objs[i] ?? null;
    const near = segs[i][segs[i].length - 1]?.rPr ?? segs[i + 1]?.[0]?.rPr ?? base;
    const mark = (s: string) => { const m = markRPr(near, doc); for (const c of s) out.push({ t: "c", c, rPr: m, wrap: "" }); };
    if (act === "delete") mark(MARK_DELETED);
    else if (act instanceof File && o.embed) { mark(MARK_REPLACED); out.push({ ...o, xml: swapImage(o.xml, o.embed, await addImage(pkg, act)) }); }
    else out.push(o);
  }
  // 문단 서식 · 책갈피만 남기고 비운 뒤, 링크별로 묶어 다시 채운다
  for (const k of [...p.children]) if (k.localName !== "pPr" && k.localName !== "bookmarkStart" && k.localName !== "bookmarkEnd") p.removeChild(k);
  for (let i = 0; i < out.length;) {
    let j = i; while (j < out.length && out[j].wrap === out[i].wrap) j++;
    const box = out[i].wrap ? (doc.importNode(xml(out[i].wrap).documentElement, true) as Element) : null;
    const host = box ?? p;
    for (let k = i; k < j;) {
      const a = out[k];
      if (a.t === "o") { host.appendChild(doc.importNode(xml(a.xml).documentElement, true)); k++; continue; }
      let m = k; while (m < j && out[m].t === "c") m++;
      const frag = xml(`<x xmlns:w="${W}">${runsXml(out.slice(k, m) as Ch[])}</x>`).documentElement;
      for (const r of [...frag.children]) host.appendChild(doc.importNode(r, true));
      k = m;
    }
    if (box) p.appendChild(box);
    i = j;
  }
}

async function ensureStyle(zip: JSZip) {
  const f = zip.file("word/styles.xml");
  if (!f) return;
  const s = await f.async("string");
  if (s.includes(`w:styleId="${EDIT_STYLE_ID}"`)) return;
  const style = `<w:style w:type="character" w:customStyle="1" w:styleId="${EDIT_STYLE_ID}"><w:name w:val="${EDIT_STYLE_NAME}"/><w:rPr><w:color w:val="C00000"/><w:highlight w:val="yellow"/></w:rPr></w:style>`;
  zip.file("word/styles.xml", s.replace(/<\/w:styles>\s*$/, `${style}</w:styles>`));
}

export const isChanged = (p: EditPara, c: ParaChange | undefined) => !!c && (c.segs.some((s, i) => s !== p.segs[i]) || c.objs.some((o) => o !== null));

// changes: 문단 번호 → 새 글 구간 · 그림 처리. 바뀐 문단만 다시 쓴다
export async function saveDocx(loaded: Awaited<ReturnType<typeof loadDocx>>, changes: Map<number, ParaChange>): Promise<Blob | null> {
  const { zip, doc, paras } = loaded;
  const ps = paragraphs(doc);
  const pkg: Pkg = {
    zip, n: 0,
    rels: xml((await zip.file(RELS)?.async("string")) ?? `<Relationships xmlns="${PKG}"/>`),
    types: xml((await zip.file("[Content_Types].xml")?.async("string")) ?? `<Types xmlns="${CT}"/>`),
  };
  let changed = 0;
  for (const [idx, c] of changes) {
    const p = ps[idx], info = paras[idx];
    if (!p || !info?.editable || c.segs.length !== info.segs.length || !isChanged(info, c)) continue;
    await rebuild(p, c, doc, pkg);
    changed++;
  }
  if (!changed) return null;
  zip.file("word/document.xml", ser.serializeToString(doc));
  if (pkg.n) { zip.file(RELS, ser.serializeToString(pkg.rels)); zip.file("[Content_Types].xml", ser.serializeToString(pkg.types)); }
  await ensureStyle(zip);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}
