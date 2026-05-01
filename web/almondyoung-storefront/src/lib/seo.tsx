import { siteConfig } from "./config/site"
import { OpenGraph, SEOTags } from "./types/common/seo"

// SEO 기본값 상수
const DEFAULT_SEO = {
  locale: "ko_KR",
  type: "website",
  cardType: "summary_large_image",
  twitterCreator: "@almondyoung",
}

// OpenGraph 메타데이터 생성 함수
const createOpenGraphMetadata = (openGraph: OpenGraph) => ({
  title: openGraph.title || siteConfig.appName,
  description: openGraph.description || siteConfig.appDescription,
  url: openGraph.url || `https://${siteConfig.domainName}/`,
  siteName: openGraph.title || siteConfig.appName,
  locale: DEFAULT_SEO.locale,
  type: DEFAULT_SEO.type,
})

// Twitter 메타데이터 생성 함수
const createTwitterMetadata = (openGraph: OpenGraph) => ({
  title: openGraph.title || siteConfig.appName,
  description: openGraph.description || siteConfig.appDescription,
  card: DEFAULT_SEO.cardType,
  creator: DEFAULT_SEO.twitterCreator,
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
    openGraph: createOpenGraphMetadata(openGraph),
    twitter: createTwitterMetadata(openGraph),
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
