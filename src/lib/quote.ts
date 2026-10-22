// 견적서 글자 → 계약 항목 (믿는구석 견적서 양식 기준, 서버 · 스크립트 공용)
// - "포스팅 4" / "10 - 브랜드 블로그" / "8 - 홈페이지 SEO 칼럼 작성 및 업로드" 처럼 수량과 내용이 한 줄에 있는 행을 읽는다
// - 광고 집행 표의 매체 이름으로 계약 채널을 판단한다 (실비 항목)
// - 금액: 원 표시 숫자 중 가장 큰 값 = 부가세 포함 합계, 그다음 = 공급가 합계
export type QuoteItem = { service: string; quantity: number; label: string | null };
export type QuoteParse = { period: string | null; amount: number | null; vatAmount: number | null; items: QuoteItem[]; channels: string[] };

const SERVICE_RULES: [RegExp, string][] = [
  [/카드\s*뉴스|카카오 채널 포스팅|인스타그램 포스팅|비즈프로필 포스팅/, "cardnews"],
  [/블로그/, "blog"],
  [/칼럼/, "column"],
  [/카페/, "cafe"],
  [/당근.*(바이럴|동네\s*생활|커뮤니티)/, "daangn"],
  [/리뷰|영수증/, "review"],
  [/AEO|에이이오/i, "aeo"],
  [/플레이스/, "place"],
];
const classify = (text: string) => SERVICE_RULES.find(([re]) => re.test(text))?.[1] ?? null;

export function parseQuote(text: string): QuoteParse {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const items = new Map<string, QuoteItem>();
  const add = (service: string | null, quantity: number, label: string | null) => {
    if (!service || !(quantity > 0) || quantity > 1000) return;
    const cur = items.get(service);
    items.set(service, { service, quantity: (cur?.quantity ?? 0) + quantity, label: cur?.label ?? label });
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/실비|무상/.test(l)) continue;                       // 광고 집행 · 무상 지원 행
    // "10 - 브랜드 블로그 ₩ 80,000 ₩ 800,000"
    let m = l.match(/^(\d{1,3})\s*-\s*([^₩\d]+)/);
    if (m) { add(classify(m[2]), Number(m[1]), m[2].trim().slice(0, 40)); continue; }
    // "포스팅 4" 다음 줄들에 매체 설명 (카드뉴스)
    m = l.match(/^([가-힣A-Za-z ]{2,20}?)\s+(\d{1,3})$/);
    if (m) {
      const context = [m[1], lines[i + 1] ?? "", lines[i + 2] ?? ""].join(" ");
      add(classify(context), Number(m[2]), null);
    }
  }
  const channels = new Set<string>();
  if (/파워링크|네이버\s*검색\s*광고|네이버\s*지도\s*광고|플레이스\s*광고/.test(text)) channels.add("naver");
  if (/당근\s*마켓\s*광고|당근마켓 애플리케이션 내 광고/.test(text)) channels.add("daangn");
  if (/카카오\s*모먼트/.test(text)) channels.add("kakao");

  const money = [...text.matchAll(/₩\s*([\d,]{5,})|([\d,]{5,})\s*₩/g)].map((m) => Number((m[1] ?? m[2]).replace(/,/g, ""))).filter((n) => n >= 10000);
  const sorted = [...new Set(money)].sort((a, b) => b - a);
  const vatAmount = sorted[0] ?? null;
  const amount = vatAmount ? (sorted.find((n) => n < vatAmount && Math.abs(n * 1.1 - vatAmount) < 1000) ?? null) : null;
  const d = text.match(/(20\d{2})[-.](\d{1,2})[-.](\d{1,2})/);
  return { period: d ? `${d[1]}-${d[2].padStart(2, "0")}` : null, amount, vatAmount, items: [...items.values()], channels: [...channels] };
}
