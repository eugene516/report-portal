import type { NextConfig } from "next";

// 광고주별 데이터는 요청마다 새로 읽어야 하므로(캐시 금지) Cache Components 를 쓰지 않고
// 각 페이지에서 dynamic = "force-dynamic" 으로 고정한다.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // 광고주 링크의 토큰이 외부 사이트로 새지 않도록
        source: "/r/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
