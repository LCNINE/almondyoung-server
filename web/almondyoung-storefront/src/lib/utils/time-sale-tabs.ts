export type TimeSaleTabSource = {
  key: string
  name: string
  handle: string
  /** 루트와 그 자손 카테고리 id 전부. */
  categoryIds: string[]
}

export type TimeSaleTab = {
  key: string
  name: string
  handle: string
  productIds: string[]
}

export const ALL_TAB_KEY = "all"

/**
 * 세일 상품이 실제로 들어있는 루트 카테고리만 탭으로 만든다.
 *
 * 고정 탭을 쓰면 대부분이 빈다 — 타임세일은 상품이 수십 개인데 루트가 열 개라, 어떤 탭은
 * 확정적으로 0 개다. 빈 탭은 손님에게 고장으로 읽힌다. 여기서 역산하면 운영자가 탭을 따로
 * 설정할 필요도 없어진다 (설정이 갈리면 그게 곧 어긋남의 근원이다).
 *
 * 상품은 말단 카테고리에 붙으므로 루트의 자손 집합과 교집합을 본다.
 */
export function deriveTimeSaleTabs(
  products: Array<{ id: string; categoryIds: string[] }>,
  sources: TimeSaleTabSource[],
  allLabel: string
): TimeSaleTab[] {
  const tabs: TimeSaleTab[] = [
    { key: ALL_TAB_KEY, name: allLabel, handle: "", productIds: products.map((p) => p.id) },
  ]

  for (const source of sources) {
    const ids = new Set(source.categoryIds)
    const productIds = products
      .filter((product) => product.categoryIds.some((id) => ids.has(id)))
      .map((product) => product.id)

    if (productIds.length > 0) {
      tabs.push({ key: source.key, name: source.name, handle: source.handle, productIds })
    }
  }

  // 카테고리가 하나뿐이면 "전체" 와 완전히 겹쳐 탭을 그릴 이유가 없다.
  return tabs.length <= 2 ? [] : tabs
}
