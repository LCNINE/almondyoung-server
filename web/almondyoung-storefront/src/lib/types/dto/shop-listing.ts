export const SHOP_LISTING_REGIONS = [
  "seoul",
  "gyeonggi",
  "incheon",
  "busan",
  "daegu",
  "gwangju",
  "daejeon",
  "ulsan",
  "sejong",
  "gangwon",
  "chungbuk",
  "chungnam",
  "jeonbuk",
  "jeonnam",
  "gyeongbuk",
  "gyeongnam",
  "jeju",
] as const

export type ShopListingRegion = (typeof SHOP_LISTING_REGIONS)[number]

export const SHOP_LISTING_BUSINESS_TYPES = [
  "nail",
  "lash",
  "semi-permanent",
  "skincare",
  "hair",
  "waxing",
  "tattoo",
  "etc",
] as const

export type ShopListingBusinessType =
  (typeof SHOP_LISTING_BUSINESS_TYPES)[number]

export const SHOP_LISTING_DEAL_TYPES = ["transfer", "lease"] as const

export type ShopListingDealType = (typeof SHOP_LISTING_DEAL_TYPES)[number]

export interface ShopListingResponseDto {
  id: string
  slug: string
  title: string
  content: string
  region: ShopListingRegion | null
  businessType: ShopListingBusinessType | null
  dealType: ShopListingDealType | null
  areaPyeong: number | null
  deposit: number | null
  monthlyRent: number | null
  keyMoney: number | null
  thumbnailFileId: string | null
  /** 샵 사진 갤러리 fileId 목록. 배열 순서가 곧 노출 순서 */
  images: string[]
  isActive: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}
