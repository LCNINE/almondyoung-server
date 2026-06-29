import { siteConfig } from "@/lib/config/site"
import { MetadataRoute } from "next"

// 크롤러에게 사이트맵 위치를 알려주고, 색인 불필요한 사적/기능 페이지만 막는다.
// countryCode prefix(/kr, /us, /jp …) 가 붙으므로 disallow 는 `*/path` 와일드카드로 매칭.
export default function robots(): MetadataRoute.Robots {
  const base = `https://${siteConfig.domainName}`

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "*/mypage",
        "*/consents",
        "*/checkout",
        "*/cart",
        "*/order",
        "*/login",
        "*/search",
        "*/test",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
