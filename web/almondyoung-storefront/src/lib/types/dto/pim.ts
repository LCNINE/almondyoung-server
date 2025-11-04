// 통신 전용 PIM DTO (관리자 스키마 기반). 컴포넌트에서 직접 사용 금지.
// fetch 응답을 1:1로 맵핑하고, UI에서 필요 없는 필드도 보존합니다.

export type ISODateString = string
export type PimStatus = "active" | "inactive" | "draft" | "archived"
export type PimPricingStrategy = "simple" | "option_based"

// 이미지 세트(일부 프로젝트에서 primary/additional 없을 수 있어 null 허용)
export interface PimImageSet {
  primary: string | null
  additional: string[]
}

// 옵션 값 (관리자 기준: 코드/표시명 모두 존재 가능)
export interface PimOptionValue {
  id: string
  optionGroupId: string
  value: string // 내부/외부 코드 (예: P0000GZK000A)
  displayName: string // 사용자 노출 라벨 (예: 카멜 브라운)
  sortOrder: number
  isActive: boolean
  createdAt: ISODateString
  updatedAt: ISODateString
}

// 옵션 그룹
export interface PimOptionGroup {
  id: string
  masterId: string
  name: string // 예: "색상"
  displayName: string // 예: "색상"
  sortOrder: number
  isRequired: boolean
  createdAt: ISODateString
  updatedAt: ISODateString
  values: PimOptionValue[]
}

// 변형(SKU) — optionValues는 빈 배열일 수도 있음(기획/입력 누락 대비)
export interface PimVariant {
  id: string
  masterId: string
  variantName: string | null
  images: PimImageSet | null
  priceAdjustment: number | null
  displayOrder: number | null
  status: PimStatus
  isDefault: boolean
  createdAt: ISODateString
  updatedAt: ISODateString
  // 정식 매핑 시: 선택된 옵션값 연결
  optionValues: Array<{
    optionGroupId?: string
    optionValueId?: string
    label?: string // 그룹 표시명(예: 색상)
    value?: string // 값 표시명(예: 카멜 브라운)
  }>
}

// 상세 DTO
export interface PimProductDetail {
  id: string
  name: string
  description: string | null
  brand?: string | null

  thumbnail?: string | null
  images?: PimImageSet | null

  basePrice?: number | null
  pricingStrategy?: PimPricingStrategy

  tags?: string[]

  attributes?: Record<string, unknown> | null

  seoTitle?: string | null
  seoDescription?: string | null
  seoKeywords?: string[] | null

  descriptionHtml?: string | null

  status: PimStatus
  isWholesaleOnly?: boolean
  isMembershipOnly?: boolean
  membershipPrice?: number | null
  wholesalePrice?: number | null

  createdAt: ISODateString
  updatedAt: ISODateString
  createdBy?: string | null
  updatedBy?: string | null

  optionGroups?: PimOptionGroup[] | null
  variants?: PimVariant[] | null

  channelProducts?: any[] | null

  reviewSummary?: PimProductReviewSummary | null
}

// 목록 DTO (트래픽/성능을 위해 필요한 필드만)
export interface PimProductListItem {
  id: string
  name: string
  brand?: string | null
  thumbnail?: string | null
  basePrice?: number | null
  membershipPrice?: number | null
  isMembershipOnly?: boolean
  tags?: string[]
  status: PimStatus
  descriptionHtml?: string | null // 썸네일 폴백용 이미지 추출에 쓰일 수 있음
  variants?: Array<Pick<PimVariant, "id" | "priceAdjustment" | "status">> | null
}

export interface PimListResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
}

// lib/types/dto/pim.ts 일부
export interface PimProductReviewSummary {
  rating?: number
  reviewCount?: number
  qnaCount?: number
  lastReviewedAt?: string
}

export interface PimCategory {
  id: string
  name: string
  slug: string
  imageUrl?: string | null
  children?: PimCategory[]
  parent?: PimCategory | null // 서버 데이터에 따라 없을 수 있음
  path?: string | null
  level?: number
  sortOrder?: number
  description?: string | null
  isActive?: boolean
  createdAt?: ISODateString | null
  updatedAt?: ISODateString | null
  createdBy?: string | null
  updatedBy?: string | null
  parentId?: string | null
}
