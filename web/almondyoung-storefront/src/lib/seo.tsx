import { OpenGraph, SEOTags } from "../types/seo"
import { appConfig } from "./app-config"

// SEO 기본값 상수
const DEFAULT_SEO = {
  locale: "ko_KR",
  type: "website",
  cardType: "summary_large_image",
  twitterCreator: "@almondyoung",
}

// OpenGraph 메타데이터 생성 함수
const createOpenGraphMetadata = (openGraph: OpenGraph) => ({
  title: openGraph.title || appConfig.appName,
  description: openGraph.description || appConfig.appDescription,
  url: openGraph.url || `https://${appConfig.domainName}/`,
  siteName: openGraph.title || appConfig.appName,
  locale: DEFAULT_SEO.locale,
  type: DEFAULT_SEO.type,
})

// Twitter 메타데이터 생성 함수
const createTwitterMetadata = (openGraph: OpenGraph) => ({
  title: openGraph.title || appConfig.appName,
  description: openGraph.description || appConfig.appDescription,
  card: DEFAULT_SEO.cardType,
  creator: DEFAULT_SEO.twitterCreator,
})

// Schema.org 데이터 생성 함수
const createSchemaData = () => ({
  "@context": "http://schema.org",
  "@type": "Store",
  name: "아몬드영",
  description: appConfig.appDescription,
  image: `https://${appConfig.domainName}/icon.png`,
  url: `https://${appConfig.domainName}/`,
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
      : `https://${appConfig.domainName}/`

  return {
    title: title || appConfig.appName,
    description: description || appConfig.appDescription,
    keywords: keywords || [appConfig.appName],
    applicationName: appConfig.appName,
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
