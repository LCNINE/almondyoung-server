import type { TimeSale } from "@/lib/api/medusa/time-sale"

type ProductRef = { id: string; categoryIds: string[] }

/**
 * 진행 중 세일 중 가장 먼저 끝나는 시각. 제목 옆 카운트다운에 쓴다 — 실제보다 길게 보이면
 * "아직 세일인 줄 알았다" CS 가 되므로 짧은 쪽이다.
 */
export function earliestEnd(sales: TimeSale[]): string | null {
  return sales.reduce<string | null>((earliest, sale) => {
    if (!sale.endsAt) return earliest
    return !earliest || sale.endsAt < earliest ? sale.endsAt : earliest
  }, null)
}

/** 상품 → 그 상품이 든 세일 중 가장 이른 종료. 카드마다 자기 남은 시간을 그린다. */
export function productEndsAt(sales: TimeSale[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const sale of sales) {
    if (!sale.endsAt) continue
    for (const id of sale.productIds) {
      const current = map.get(id)
      if (!current || sale.endsAt < current) map.set(id, sale.endsAt)
    }
  }
  return map
}

/**
 * 세일 상품 전체를 보여줄 순서. 서버가 판매순 → 리뷰순 → 최신순으로 준 `products` 를 쓴다.
 * 배포가 섞여 옛 Medusa 가 `products` 없이 응답하면 세일별 목록을 이어 붙인다(카테고리 탭은 빈다).
 */
export function orderedProducts(overview: { sales: TimeSale[]; products?: ProductRef[] }): ProductRef[] {
  if (overview.products) return overview.products
  const seen = new Set<string>()
  const ordered: ProductRef[] = []
  for (const sale of overview.sales) {
    for (const id of sale.productIds) {
      if (seen.has(id)) continue
      seen.add(id)
      ordered.push({ id, categoryIds: [] })
    }
  }
  return ordered
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    totalPages,
  }
}
