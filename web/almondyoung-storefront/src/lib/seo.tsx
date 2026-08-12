import { siteConfig } from "./config/site"
import { OpenGraph, SEOTags } from "./types/common/seo"

// 색인 불필요한 페이지(장바구니·마이페이지·결제 등)용. robots.txt 로 크롤을 막으면
// 크롤러가 이 지시를 읽을 수 없어 URL 만 색인된 채 남는다 — 반드시 크롤은 열어두고
// 이 태그로 뺀다. follow 는 켜둬야 링크된 상품 페이지로 크롤이 흘러간다.
export const NOINDEX = { index: false, follow: true } as const

// SEO 기본값 상수
const DEFAULT_SEO = {
  locale: "ko_KR",
  type: "website",
  cardType: "summary_large_image",
  twitterCreator: "@almondyoung",
}

// 링크 공유 카드(카톡·슬랙·트위터)에 뜨는 대표 이미지.
const DEFAULT_OG_IMAGE = {
  url: "/og-image.jpg",
  width: 1200,
  height: 630,
  alt: "아몬드영 — 세상의 모든 미용재료가 있는 곳",
}

// OpenGraph 메타데이터 생성 함수
const createOpenGraphMetadata = (openGraph: OpenGraph) => ({
  title: openGraph.title || siteConfig.appName,
  description: openGraph.description || siteConfig.appDescription,
  url: openGraph.url || `https://${siteConfig.domainName}/`,
  siteName: openGraph.title || siteConfig.appName,
  locale: DEFAULT_SEO.locale,
  type: DEFAULT_SEO.type,
  images: [DEFAULT_OG_IMAGE],
})

// Twitter 메타데이터 생성 함수
const createTwitterMetadata = (openGraph: OpenGraph) => ({
  title: openGraph.title || siteConfig.appName,
  description: openGraph.description || siteConfig.appDescription,
  card: DEFAULT_SEO.cardType,
  creator: DEFAULT_SEO.twitterCreator,
  images: [DEFAULT_OG_IMAGE],
})

// Schema.org 데이터 생성 함수
const createSchemaData = () => ({
  "@context": "http://schema.org",
  "@type": "Store",
  name: "아몬드영",
  description: siteConfig.appDescription,
  image: `https://${siteConfig.domainName}/icon.png`,
  url: `https://${siteConfig.domainName}/`,
})

export const getSEOTags = ({
  title,
  description,
  keywords,
  openGraph,
  canonicalUrlRelative,
  extraTags,
}: SEOTags) => {
  const baseUrl =
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000/"
      : `https://${siteConfig.domainName}/`

  return {
    title: title || siteConfig.appName,
    description: description || siteConfig.appDescription,
    keywords: keywords || [siteConfig.appName],
    applicationName: siteConfig.appName,
    metadataBase: new URL(baseUrl),
    // 페이지가 openGraph.description 을 따로 안 주면 페이지 description 을 물려받는다
    openGraph: createOpenGraphMetadata({ description, ...openGraph }),
    twitter: createTwitterMetadata({ description, ...openGraph }),
    ...(canonicalUrlRelative && {
      alternates: { canonical: canonicalUrlRelative },
    }),
    ...extraTags,
  }
}

export const renderSchemaTags = () => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{
      __html: JSON.stringify(createSchemaData()),
    }}
  />
)
