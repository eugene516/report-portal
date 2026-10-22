"use client";
// 자동 수집 채널: 매일 9시 점검이 이 주소에서 이번 달 발행 글을 찾아 리포트에 넣는다
// (블로그 → 블로그 원고 · 순위, 홈페이지 칼럼, 인스타그램 · 카카오 채널 · 당근 소식 → SNS 카드뉴스 링크)
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { toast, toastError } from "@/components/ui";

const KINDS = [
  { id: "blog", label: "네이버 블로그", hint: "https://blog.naver.com/아이디" },
  { id: "column", label: "홈페이지 칼럼 게시판", hint: "https://홈페이지/column/" },
  { id: "instagram", label: "인스타그램", hint: "https://www.instagram.com/계정/" },
  { id: "kakao", label: "카카오 채널 소식", hint: "https://pf.kakao.com/_xxxx/posts" },
  { id: "daangn", label: "당근 비즈프로필", hint: "https://www.daangn.com/kr/local-profile/..." },
] as const;

export default function SourcesEditor({ clientId, sources }: { clientId: string; sources: Record<string, string> }) {
  const router = useRouter();
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sb = supabaseBrowser();
    const up = [], del = [];
    for (const k of KINDS) {
      const v = String(fd.get(k.id) ?? "").trim();
      if (!v) { if (sources[k.id]) del.push(k.id); continue; }
      if (!/^https:\/\/\S+$/.test(v)) return toastError(`${k.label} 주소는 https:// 로 시작해야 합니다.`);
      if (v !== sources[k.id]) up.push({ client_id: clientId, kind: k.id, url: v, updated_at: new Date().toISOString() });
    }
    const r1 = up.length ? await sb.from("client_sources").upsert(up) : { error: null };
    const r2 = del.length ? await sb.from("client_sources").delete().eq("client_id", clientId).in("kind", del) : { error: null };
    if (r1.error || r2.error) return toastError("저장하지 못했습니다.");
    toast("자동 수집 채널을 저장했습니다. 내일 오전 9시 점검부터 반영됩니다.");
    router.refresh();
  }
  return (
    <section className="card pad mt">
      <h2>자동 수집 채널</h2>
      <p className="faint">매일 오전 9시 점검이 아래 주소에서 <b>이번 달에 올라온 글</b>을 찾아 리포트에 넣습니다. 이번 달 글이 없으면 아무것도 넣지 않습니다. 비워 두면 그 채널은 확인하지 않습니다.</p>
      <form className="sources-form mt" onSubmit={save}>
        {KINDS.map((k) => (
          <label key={k.id}>{k.label}<input name={k.id} defaultValue={sources[k.id] ?? ""} placeholder={k.hint} className="search" inputMode="url" /></label>
        ))}
        <div><button className="btn primary sm">저장</button></div>
      </form>
    </section>
  );
}
