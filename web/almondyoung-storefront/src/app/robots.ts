import { siteConfig } from "@/lib/config/site"
import { MetadataRoute } from "next"

// 크롤러에게 사이트맵 위치를 알려준다.
//
// 색인 불필요한 사적/기능 페이지(장바구니·마이페이지·결제·검색 등)는 여기서 막지 않는다.
// robots.txt 로 크롤을 막으면 크롤러가 페이지의 noindex 를 읽을 수 없어 URL 만 색인된
// 상태로 남고, 실제로 /cart 가 그 상태로 사이트링크에 올라왔다. 대신 각 라우트에
// `robots: NOINDEX`(lib/seo.tsx) 를 달아 크롤은 허용하되 색인에서 빼고, follow 로
// 내부 링크는 계속 타게 한다.
//
// 여기 남는 건 크롤 자체가 무의미한 경로뿐 (countryCode prefix 때문에 `*/path` 와일드카드).
export default function robots(): MetadataRoute.Robots {
  const base = `https://${siteConfig.domainName}`

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "*/test"],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
