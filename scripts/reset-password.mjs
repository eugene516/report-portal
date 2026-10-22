// 직원 비밀번호 재설정 (메일 발송 설정 전 비상용)
// 사용: node scripts/reset-password.mjs 이메일
// - 새 비밀번호는 화면에 표시되지 않게 입력받고, 어디에도 저장하지 않는다.
// - 이 PC에 로그인된 Supabase CLI 권한으로 실행된다.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^@\s']+@[^@\s']+\.[^@\s']+$/.test(email)) {
  console.error("사용법: node scripts/reset-password.mjs 이메일");
  process.exit(1);
}

function ask(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode?.(false); stdin.pause(); stdin.off("data", onData);
        process.stdout.write("\n"); resolve(value);
      } else if (ch === "\u0003") { process.exit(130); }
      else if (ch === "\b" || ch === "\u007f") { value = value.slice(0, -1); }
      else { value += ch; process.stdout.write("*"); }
    };
    stdin.on("data", onData);
  });
}

const pw = await ask("새 비밀번호 (10자 이상, 대문자·소문자·숫자 포함): ");
if (pw.length < 10 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) {
  console.error("비밀번호 규칙에 맞지 않습니다. 다시 실행해 주세요.");
  process.exit(1);
}
if ((await ask("한 번 더 입력: ")) !== pw) {
  console.error("두 입력이 다릅니다. 다시 실행해 주세요.");
  process.exit(1);
}

const lit = (s) => "'" + s.replace(/'/g, "''") + "'";
const sql = `update auth.users set encrypted_password = extensions.crypt(${lit(pw)}, extensions.gen_salt('bf', 10)), updated_at = now() where email = ${lit(email)} returning email`;
const out = execFileSync("node", [path.join(root, "node_modules/supabase/dist/supabase.js"), "db", "query", "--linked", sql], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
console.log(out.includes(email) ? `완료: ${email} 비밀번호를 바꿨습니다.` : `해당 이메일의 직원 계정을 찾지 못했습니다: ${email}`);
