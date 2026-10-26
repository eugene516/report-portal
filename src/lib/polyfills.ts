// 이전 Safari(iOS · macOS 15.3 이하)에 없는 기능 채우기 — 모든 화면에 들어가는 ui.tsx 에서 불러온다
// crypto.randomUUID (Safari 15.4+), Array.prototype.at (15.4+), Object.hasOwn (15.4+)
if (typeof window !== "undefined") {
  const c = window.crypto as Crypto & { randomUUID?: () => string };
  if (c && typeof c.randomUUID !== "function" && typeof c.getRandomValues === "function") {
    c.randomUUID = () => {
      const b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;
    };
  }
  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, "at", { configurable: true, writable: true, value: function <T>(this: T[], i: number) { const n = Math.trunc(i) || 0; return this[n < 0 ? this.length + n : n]; } });
  }
  if (!Object.hasOwn) {
    Object.defineProperty(Object, "hasOwn", { configurable: true, writable: true, value: (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k) });
  }
}
export {};
