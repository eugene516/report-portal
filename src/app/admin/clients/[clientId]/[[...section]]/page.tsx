// 직원용 광고주 리포트: 로그인 + 직원 권한 필요. 광고주 링크와 같은 화면에 "홈으로 돌아가기"만 추가된다.
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import ReportPage from "@/components/ReportPage";

export const dynamic = "force-dynamic";

export default async function StaffClientPage({
  params, searchParams,
}: { params: Promise<{ clientId: string; section?: string[] }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStaff();
  const { clientId, section = [] } = await params;
  if (!/^[0-9a-f-]{36}$/.test(clientId)) notFound();
  return <ReportPage ctx={{ mode: "staff", clientId }} section={section} searchParams={await searchParams} showHome />;
}
