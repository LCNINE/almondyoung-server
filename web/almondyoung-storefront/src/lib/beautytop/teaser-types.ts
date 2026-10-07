export type TeaserShop = { id: number; name: string; sido: string; gugun: string; category: string }

export type TeaserSummary = {
  scopes: Array<{ label: string; total: number }>
  metrics: { ahead: number; behind: number; even: number; pricePosition: number; unknown: number }
}
