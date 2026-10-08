export type BeautyTopOptions = {
  regions: { sido: string; gugun: string }[]
  services: { id: string; name: string; category: string }[]
}

export type BeautyTopPriceGroup = {
  service_id: string
  name: string
  brands: number
  menus: number
  min: number
  max: number
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
  reason?: string | null
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
  ranks?: {
    label: string
    rank: number
    total: number
    filters?: { category?: string; sido?: string; gugun?: string }
  }[]
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
    metrics: {
      key: string
      current: number | null
      current_at?: string | null
      status?: string
      previous?: number | null
      delta?: number | null
      rate_pct?: number | null
      unit?: string
      label?: string
    }[]
    activity?: { is_lower_bound: boolean; observed_at?: string; since?: string }
    history?: {
      note?: string
      series: {
        key: string
        label: string
        unit: string
        status: string
        stale?: boolean
        points: { at: string; value: number; approximate?: boolean }[]
      }[]
    }
  }
  posting?: {
    rank_eligible: boolean
    median_gap_days: number | null
    observed_at?: string | null
    recent_posts?: number
    sample_posts?: number
    windows?: Record<string, { observed: number; is_lower_bound: boolean }>
  }
  metrics?: {
    instagram_score?: number | null
    area_m2?: number | null
    source_dates?: Record<string, string | null>
  }
  workforce?: {
    selected: {
      count: number | null
      label: string
      period: string | null
      source_date: string | null
      is_actual_total: boolean
    }
    review_pending?: boolean
  }
  menu_benchmark?: {
    fixed_price_menus: number
    min: number | null
    median: number | null
    max: number | null
    note?: string
  }
  price_history: {
    stale?: boolean
    series: {
      name: string
      points: {
        value: number
        at?: string
        high?: number | null
        kind?: string
        basis_changed?: boolean
      }[]
    }[]
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

export type BeautyTopMetricRow = BeautyTopShopSummary & {
  rank: number
  instagram_score?: number | null
  area_m2?: number | null
  value?: number | null
  median_gap_days?: number | null
  followers_approximate?: boolean
  source_dates?: Record<string, string | null>
  headcount?: { label: string; period: string | null; is_actual_total: boolean }
}

export type BeautyTopMetricRanking = {
  items: BeautyTopMetricRow[]
  average?: number | null
  total?: number
  note?: string
  metrics_updated_at?: string
}

type Ready = { ready: boolean }

export type BeautyTopProcedure = {
  id: string
  name: string
  category: string
  mentions: Ready & { shops: number; share_percent: number | null }
  growth: Ready & { change_pp: number | null }
  adoption: { ready?: boolean; current_shops: number; checked_shops: number }
  regional: Ready & {
    local_percent?: number | null
    national_percent?: number | null
  }
}

export type BeautyTopTrends = {
  procedures?: { available: boolean; rows: BeautyTopProcedure[] }
}
