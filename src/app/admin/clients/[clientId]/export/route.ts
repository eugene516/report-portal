// 레포트 상세보기 엑셀 내려받기 (직원): ?period=YYYY-MM
// 담당 여부는 데이터를 읽는 DB 함수(RLS)가 확인한다 — 권한이 없으면 광고주 정보가 조회되지 않아 404
import { getStaff } from "@/lib/auth";
import { buildReportXlsx, xlsxResponse } from "@/lib/report-xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(clientId)) return new Response(null, { status: 404 });
  if (!(await getStaff())) return new Response(null, { status: 401 });
  const file = await buildReportXlsx({ mode: "staff", clientId }, new URL(req.url).searchParams.get("period") ?? undefined);
  return file ? xlsxResponse(file) : new Response(null, { status: 404 });
}
