/*───────────────────────────
 * Common Types
 *──────────────────────────*/
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

/*───────────────────────────
 * Product Masters
 *──────────────────────────*/

// 상품 목록 아이템
export interface ProductListItemDto {
  masterId: string
  versionId: string
  name: string
  thumbnail: string | null
  brand: string | null
  isMembershipOnly: boolean
  status: "draft" | "active" | "inactive"
  createdAt: string
  optionGroupNames: string[]
  variantCount: number
}

// 상품 목록 응답
export interface ProductListResponseDto extends PaginatedResponse<ProductListItemDto> {}

// 옵션 그룹 DTO
export interface OptionGroupDto {
  id: string
  displayName: string
  sortOrder: number
  values: OptionValueDto[]
}

// 옵션 값 DTO
export interface OptionValueDto {
  id: string
  displayName: string
  sortOrder: number
  colorCode?: string | null
  imageUrl?: string | null
}

// Variant DTO
// 기본 Variant 정보 (optionValues는 VariantWithPriceDto에만 포함)
export interface VariantDto {
  id: string
  variantName: string
  status: "active" | "inactive"
  isDefault: boolean
  // optionValues는 VariantWithPriceDto에만 포함됨
  // ProductDetailDto의 variants에는 optionValues가 없음
}

// 태그 값 DTO
export interface TagValueDto {
  id: string
  name: string
  groupId: string
  groupName: string
}

// 상품 상세 응답
export interface ProductDetailDto {
  id: string // versionId
  masterId: string
  version: number
  status: "draft" | "active" | "inactive"
  name: string
  description: string | null
  brand: string | null
  thumbnail: string | null
  descriptionHtml?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  seoKeywords?: string[] | null
  isWholesaleOnly: boolean
  isMembershipOnly: boolean
  tags?: string[] | null
  attributes?: Record<string, any> | null
  optionGroups: OptionGroupDto[]
  variants: VariantDto[]
  tagValues: TagValueDto[]
  createdAt?: string | null
  updatedAt?: string | null
}

// ==========================================
// Product Versions
// ==========================================

// 버전 DTO
export interface ProductVersionDto {
  id: string // versionId
  masterId: string
  version: number
  status: "draft" | "active" | "inactive"
  name: string
  brand?: string | null
  thumbnail?: string | null
  createdAt: string
  updatedAt: string
  parentVersionId?: string | null
  draftOwnerId?: string | null
}

// 버전 트리 응답
export interface VersionTreeResponseDto extends ProductVersionDto {
  children: VersionTreeResponseDto[]
}

/*───────────────────────────
 * Product Variants
 *──────────────────────────*/
// Variant 목록 아이템
export interface VariantListItemDto {
  id: string
  masterId: string
  variantName: string
  images: string[]
  status: "active" | "inactive"
  isDefault: boolean
  price?: number
}

// Variant 목록 응답
export interface VariantListResponseDto extends PaginatedResponse<VariantListItemDto> {}

// Variant 상세 (가격 포함)
export interface VariantWithPriceDto extends VariantListItemDto {
  optionValues: Array<{
    id: string
    optionGroupId: string
    displayName: string
  }>
}

/*───────────────────────────
 * Pricing
 *──────────────────────────*/
// 가격 규칙 DTO
export interface PricingRuleDto {
  ruleId: string
  layer: "base_price" | "membership_price" | "tiered_price"
  order: number
  scopeType: "all_variants" | "with_option" | "variants"
  scopeTargetIds: string[]
  operationType: "offset" | "scale" | "override"
  operationValue: number
  minQuantity?: number | null
  description?: string | null
}

/*───────────────────────────
 * Categories
 *──────────────────────────*/
// 카테고리 표시 설정
export interface CategoryDisplaySettings {
  mobileOnly?: boolean
  pcAndMobile?: boolean
  menuPositions?: {
    topMenu?: boolean
    leftSide?: boolean
    footerMenu?: boolean
  }
  defaultSortField?: string
  showOnMainCategory?: boolean
  productDisplayOrder?: "asc" | "desc"
}

export interface CategorySeoConfig {
  metaAuthor: string
  browserTitle: string
  metaKeywords: string[]
  metaDescription: string
  showInSearchEngines: boolean
}

export interface CategoryTemplateConfig {
  templateType: "default" | string
}

// 카테고리 트리 노드
export interface CategoryTreeNodeDto {
  id: string
  name: string
  description: string | null
  slug: string
  parentId: string | null
  level: number
  path: string
  sortOrder: number
  isActive: boolean
  visibility: boolean
  productCount?: number
  imageUrl?: string | null
  displaySettings?: CategoryDisplaySettings | null
  display_settings?: string | null
  seoConfig?: CategorySeoConfig | null
  templateConfig?: CategoryTemplateConfig | null
  createdAt: string
  updatedAt: string
  createdBy: string | null
  updatedBy: string | null
  children: CategoryTreeNodeDto[]
}

// 카테고리 트리 응답
export interface CategoryTreeResponseDto {
  categories: CategoryTreeNodeDto[]
  totalCount: number
  maxDepth: number
}

// 카테고리 기본 응답
export interface CategoryResponseDto {
  id: string
  name: string
  description: string | null
  slug: string
  parentId: string | null
  level: number
  path: string
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  childCount?: number
  productCount?: number
  thumbnail?: string | null
  basePrice?: string | null
  imageUrl?: string | null
  display_settings?: string | null
}

// 카테고리 상세 응답
export interface CategoryDetailResponseDto {
  id: string
  name: string
  description: string | null
  slug: string
  parentId: string | null
  level: number
  path: string
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  parent?: CategoryResponseDto
  children: CategoryResponseDto[]
  productCount: number
  totalProductCount: number
  imageUrl?: string | null
}

// 카테고리 경로 정보
export interface CategoryPathInfoDto {
  id: string
  name: string
  slug: string
  level: number
}

// 카테고리 경로 응답
export interface CategoryPathResponseDto {
  categoryId: string
  path: CategoryPathInfoDto[]
  fullPath: string
}

// ==========================================
// Search
// ==========================================

export const SEARCH_SORT_VALUES = [
  "relevance",
  "newest",
  "price_asc",
  "price_desc",
] as const

export type SearchSort = (typeof SEARCH_SORT_VALUES)[number]

// 검색 결과 상품 아이템
export interface ProductSearchItemDto {
  productId: string
  versionId: string
  name: string
  thumbnail: string | null
  brand: string | null
  minBasePrice: number | null
  maxBasePrice: number | null
  minMembershipPrice: number | null
  maxMembershipPrice: number | null
  categoryIds: string[]
  score: number | null
}

// 페이지네이션 DTO
export interface PaginationDto {
  page: number
  size: number
  total: number
  totalPages: number
}

// 검색 응답 DTO
export interface ProductSearchResponseDto {
  items: ProductSearchItemDto[]
  pagination: PaginationDto
}

// ==========================================
// Banner
// ==========================================

export interface BannerGroupDto {
  id: string
  code: string
  title: string
  category: string
  pcWidth: number | null
  pcHeight: number | null
  mobileWidth: number | null
  mobileHeight: number | null
  description: string | null
  isActive: boolean
  sortOrder: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  banners: BannerDto[]
}

export interface BannerDto {
  id: string
  bannerGroupId: string
  title: string
  description: string | null
  pcImageFileId: string
  mobileImageFileId: string
  linkUrl: string | null
  linkedProductMasterIds: string[] | null
  displayStartAt: string | null
  displayEndAt: string | null
  isActive: boolean
  sortOrder: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}
