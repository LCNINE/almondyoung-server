export interface OpenGraph {
  title?: string
  description?: string
  image?: string
  url?: string
}
export interface twitter {
  title?: string
  description?: string
  image?: string
}

export interface SEOTags {
  title?: string
  description?: string
  keywords?: string
  openGraph: OpenGraph
  twitter: twitter
  canonicalUrlRelative?: string
  extraTags: {}
}
