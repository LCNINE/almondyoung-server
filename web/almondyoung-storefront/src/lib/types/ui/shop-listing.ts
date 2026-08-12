import {
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_DEAL_TYPES,
  SHOP_LISTING_REGIONS,
  type ShopListingBusinessType,
  type ShopListingDealType,
  type ShopListingRegion,
  type ShopListingResponseDto,
} from "../dto/shop-listing"

export {
  SHOP_LISTING_REGIONS,
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_DEAL_TYPES,
}
export type { ShopListingRegion, ShopListingBusinessType, ShopListingDealType }

export interface ShopListingItem extends ShopListingResponseDto {}

export const SHOP_TRADE_VIEWS = ["grid", "list"] as const
export type ShopTradeView = (typeof SHOP_TRADE_VIEWS)[number]

export const SHOP_TRADE_PAGE_SIZES = [15, 30, 60] as const
export const SHOP_TRADE_DEFAULT_PAGE_SIZE = 15

/** 권리금 구간 필터 (원 단위 상한). null = 상한 없음 */
export const SHOP_TRADE_KEY_MONEY_BANDS = [
  { key: "under1000", max: 10_000_000 },
  { key: "1000to3000", min: 10_000_000, max: 30_000_000 },
  { key: "3000to5000", min: 30_000_000, max: 50_000_000 },
  { key: "over5000", min: 50_000_000 },
] as const

export type ShopTradeKeyMoneyBand =
  (typeof SHOP_TRADE_KEY_MONEY_BANDS)[number]["key"]
