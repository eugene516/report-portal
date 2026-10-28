// 광고주 전용 링크: 그 광고주에 등록된 이메일로 로그인해야 리포트가 보인다 (비밀번호 · 메일 인증 없음).
// 토큰은 DB 함수가 검증한다. 직원으로 로그인한 상태면 그대로 보인다.
// 이 경로에서는 "홈으로 돌아가기" 버튼을 렌더링하지 않는다 (showHome=false 고정).
import ReportPage from "@/components/ReportPage";
import { ClientEmailLogin } from "@/components/review/ReviewAuth";
import { getStaff } from "@/lib/auth";
import { getClientSummary } from "@/lib/report";
import { getReviewViewer } from "@/lib/review";

export const metadata = { title: "마케팅 리포트", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ClientLinkPage({
  params, searchParams,
}: { params: Promise<{ token: string; section?: string[] }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token, section = [] } = await params;
  const client = await getClientSummary({ mode: "client", token });
  if (client && !(await getStaff())) {
    const viewer = await getReviewViewer(client.id);
    if (viewer.kind !== "client") {
      return (
        <main className="login-wrap">
          <ClientEmailLogin token={token} clientName={client.name} other={viewer.kind === "other"} />
        </main>
      );
    }
  }
  return <ReportPage ctx={{ mode: "client", token }} section={section} searchParams={await searchParams} staffTools={false} />;
}
