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
  title?: string | { default: string; template: string }
  description?: string
  keywords?: string[]
  openGraph: OpenGraph
  canonicalUrlRelative?: string
  extraTags?: Record<string, any>
}
