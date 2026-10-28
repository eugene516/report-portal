// 레포트 상세보기 엑셀 내려받기 (광고주 링크): ?period=YYYY-MM
// 링크 화면과 같은 조건 — 그 광고주에 등록된 이메일로 로그인했거나 직원으로 로그인한 경우만
import { getStaff } from "@/lib/auth";
import { getClientSummary } from "@/lib/report";
import { getReviewViewer } from "@/lib/review";
import { buildReportXlsx, xlsxResponse } from "@/lib/report-xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const client = await getClientSummary({ mode: "client", token });
  if (!client) return new Response(null, { status: 404 });
  if (!(await getStaff()) && (await getReviewViewer(client.id)).kind !== "client") return new Response(null, { status: 403 });
  const file = await buildReportXlsx({ mode: "client", token }, new URL(req.url).searchParams.get("period") ?? undefined);
  return file ? xlsxResponse(file) : new Response(null, { status: 404 });
}
