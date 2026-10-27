"use client";
// 블로그 원고 키워드 수정 (직원 화면 전용). 바꾼 키워드로 다음 날 오전 9시 30분 점검부터 순위를 확인한다
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { toast, toastError } from "./ui";

export default function BlogKeywordEdit({ id, keyword }: { id: string; keyword: string }) {
  const router = useRouter();
  async function edit() {
    const v = window.prompt("순위를 확인할 검색 키워드", keyword)?.trim();
    if (!v || v === keyword) return;
    const { error } = await supabaseBrowser().from("blog_posts").update({ keyword: v.slice(0, 60) }).eq("id", id);
    if (error) return toastError("키워드를 바꾸지 못했습니다.");
    toast("키워드를 바꿨습니다. 다음 오전 9시 30분 점검부터 이 키워드로 순위를 확인합니다.");
    router.refresh();
  }
  return <button className="link-x kw-edit" onClick={edit} title="키워드 수정" aria-label="키워드 수정">✎</button>;
}
