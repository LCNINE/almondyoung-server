import {
  SHOP_TRADE_DEFAULT_PAGE_SIZE,
  type ShopListingBusinessType,
  type ShopListingRegion,
  type ShopTradeKeyMoneyBand,
  type ShopListingDealType,
  type ShopTradeView,
} from "@/lib/types/ui/shop-listing"

export type ShopTradeListParams = {
  region: ShopListingRegion | null
  businessType: ShopListingBusinessType | null
  dealType: ShopListingDealType | null
  keyMoney: ShopTradeKeyMoneyBand | null
  view: ShopTradeView
  size: number
  page: number
}

export function buildListHref(
  current: ShopTradeListParams,
  patch: Partial<ShopTradeListParams>
): string {
  const next = { ...current, ...patch }
  const params = new URLSearchParams()

  if (next.region) params.set("region", next.region)
  if (next.businessType) params.set("business", next.businessType)
  if (next.dealType) params.set("deal", next.dealType)
  if (next.keyMoney) params.set("keyMoney", next.keyMoney)
  if (next.view !== "grid") params.set("view", next.view)
  if (next.size !== SHOP_TRADE_DEFAULT_PAGE_SIZE)
    params.set("size", String(next.size))
  if (next.page > 1) params.set("page", String(next.page))

  const query = params.toString()
  return query ? `/shop-trade?${query}` : "/shop-trade"
}

/** 필터가 하나라도 걸려 있는지 — 빈 결과 문구를 가르는 판정이라 한 곳에서만 정의한다 */
export function hasActiveFilter(params: ShopTradeListParams): boolean {
  return Boolean(
    params.region || params.businessType || params.dealType || params.keyMoney
  )
}
