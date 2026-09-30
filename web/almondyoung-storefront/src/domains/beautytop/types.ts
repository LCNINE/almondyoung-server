export type BeautyTopOptions = {
  regions: { sido: string; gugun: string }[]
  services: { id: string; name: string; category: string }[]
}

export type BeautyTopPriceGroup = {
  service_id: string
  name: string
  brands: number
  menus: number
  minimum: number
  maximum: number
  median: number | null
}

export type BeautyTopPrice = {
  available: boolean
  groups: BeautyTopPriceGroup[]
}

export type BeautyTopMarket = {
  available: boolean
  shops?: number
  opened_last_year?: number
  residents_per_shop?: number | null
}

export type BeautyTopLifecycle = {
  available: boolean
  opened?: number
  closed?: number
  monthly?: { month: string; opened: number; closed: number }[]
}

export type BeautyTopRevenue = {
  available: boolean
  groups?: {
    industry: string
    period: string
    yoy_percent: number | null
    qoq_percent: number | null
    series: { period: string; sales_won: number }[]
  }[]
}

export type BeautyTopKind = "SHOP" | "PERSON"

export type BeautyTopTarget = { id: number; kind: BeautyTopKind }

export const targetKey = (kind: BeautyTopKind, id: number) => `${kind}:${id}`

export type BeautyTopShopSummary = {
  id: number
  entity_type: BeautyTopKind
  name: string
  category: string | null
  sido: string | null
  gugun: string | null
  followers: number | null
  visitor_reviews: number | null
}

export type BeautyTopRankItem = BeautyTopShopSummary & { rank: number }

export type BeautyTopRanking = { items: BeautyTopRankItem[] }

export type BeautyTopSearch = { items: BeautyTopShopSummary[]; total: number }

export type BeautyTopPosition = {
  available: boolean
  ranks?: { label: string; rank: number; total: number }[]
}

export type BeautyTopPeerMetric = {
  key: string
  current: number | null
  median: number | null
  rank: number | null
  rank_total: number | null
  status: string
}

export type BeautyTopChangeEvent = {
  type: string
  label: string
  previous: number | null
  current: number | null
  delta: number | null
  unit: string
  observed_at: string
}

export type BeautyTopBriefing = {
  available: boolean
  peers?: {
    available: boolean
    peer_count: number
    criteria: string[]
    service: string | null
    services: { id: string; name: string }[]
    metrics: BeautyTopPeerMetric[]
  }
  changes?: { events: BeautyTopChangeEvent[] }
}

export type BeautyTopShop = {
  id: number
  name: string
  category: string | null
  address: string | null
  naver: { url: string } | null
  social_accounts: { handle: string }[]
  growth: {
    metrics: { key: string; current: number | null }[]
  }
  price_history: {
    series: { name: string; points: { value: number }[] }[]
  }
}

export type BeautyTopFranchise = {
  items: {
    id: string
    brand: string
    history: {
      report_year: number
      franchised: number | null
      average_sales_won: number | null
    }[]
  }[]
  total: number
}

export type BeautyTopWatch = { items: BeautyTopShopSummary[] }

export type BeautyTopChanges = {
  events: (BeautyTopChangeEvent & {
    brand: { id: number; name: string; entity_type: BeautyTopKind }
  })[]
}

export type BeautyTopPriceList = {
  available: boolean
  total?: number
  items?: {
    id: number
    entity_type: BeautyTopKind
    name: string
    menu_name: string
    value: number
  }[]
}
