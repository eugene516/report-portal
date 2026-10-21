// 광고주 전용 링크: 로그인 없음. 토큰은 DB 함수가 검증한다.
// 이 경로에서는 "홈으로 돌아가기" 버튼을 렌더링하지 않는다 (showHome=false 고정).
import ReportPage from "@/components/ReportPage";

export const metadata = { title: "마케팅 리포트", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ClientLinkPage({
  params, searchParams,
}: { params: Promise<{ token: string; section?: string[] }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token, section = [] } = await params;
  return <ReportPage ctx={{ mode: "client", token }} section={section} searchParams={await searchParams} staffTools={false} />;
}
