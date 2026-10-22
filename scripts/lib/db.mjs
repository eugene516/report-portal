// 이 PC의 Supabase CLI 로그인(연결된 프로젝트)으로 SQL 을 실행한다. 예약 작업(내보내기 · 매일 점검) 전용.
// - 비밀값을 파일에 두지 않는다: CLI 가 저장해 둔 로그인 정보를 그대로 쓴다.
// - 긴 SQL 은 임시 파일로 넘긴다(명령줄 길이 제한).
// - 값은 jsonb 로 묶어 넘겨 SQL 문자열에 직접 끼워 넣지 않는다(lit / json 참고).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const APP = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const CLI = join(APP, "node_modules/supabase/dist/supabase.js");

export function sql(query) {
  const dir = mkdtempSync(join(tmpdir(), "rp-sql-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, query, "utf8");
  try {
    const out = execFileSync(process.execPath, [CLI, "db", "query", "--linked", "-f", file], { cwd: APP, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const start = out.indexOf("{");
    return start < 0 ? [] : (JSON.parse(out.slice(start)).rows ?? []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 임의 태그 달러 인용: 페이지에서 가져온 글자에 따옴표가 있어도 SQL 이 깨지지 않는다
export function json(value) {
  const tag = "j" + randomBytes(6).toString("hex");
  return `$${tag}$${JSON.stringify(value)}$${tag}$::jsonb`;
}
export const lit = (s) => { const tag = "t" + randomBytes(6).toString("hex"); return `$${tag}$${s}$${tag}$`; };

// 한국시간
export const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600_000);
export const kstDate = (d = new Date()) => kst(d).toISOString().slice(0, 10);
