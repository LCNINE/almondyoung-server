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

export const SHOP_LISTING_STATUSES = [
  "pending",
  "published",
  "rejected",
  "hidden",
  "closed",
] as const

export type ShopListingStatus = (typeof SHOP_LISTING_STATUSES)[number]

/** ugc `GET /shop-listings/public(/:slug)`. 연락처·작성자는 없다. status 는 published 또는 closed */
export interface ShopListingResponseDto {
  id: string
  slug: string
  title: string
  /** 마크다운 */
  content: string
  region: ShopListingRegion | null
  businessType: ShopListingBusinessType | null
  dealType: ShopListingDealType | null
  areaPyeong: number | null
  deposit: number | null
  monthlyRent: number | null
  keyMoney: number | null
  /** imageFileIds[0] */
  thumbnailFileId: string | null
  /** 순서 = 노출 순서 */
  imageFileIds: string[]
  status: ShopListingStatus
  viewCount: number
  createdAt: string
  updatedAt: string
}

/** ugc `GET /shop-listings/mine`·`/:id`. 작성 회원 본인에게만 */
export interface MyShopListingResponseDto extends ShopListingResponseDto {
  /** status 가 rejected 일 때만 */
  rejectReason: string | null
  /** 숫자만 */
  contactPhone: string | null
  kakaoOpenChatUrl: string | null
  submittedAt: string | null
}

/** ugc `GET /shop-listings/public/:slug/contact` (로그인 필요) */
export interface ShopListingContactDto {
  contactPhone: string | null
  kakaoOpenChatUrl: string | null
}

/** ugc `POST /shop-listings`·`PUT /shop-listings/:id` 본문 */
export interface MemberShopListingPayload {
  title: string
  content: string
  region: ShopListingRegion
  businessType: ShopListingBusinessType
  dealType: ShopListingDealType
  areaPyeong: number | null
  deposit: number | null
  monthlyRent: number | null
  keyMoney: number | null
  imageFileIds: string[]
  contactPhone: string
  kakaoOpenChatUrl: string | null
}
