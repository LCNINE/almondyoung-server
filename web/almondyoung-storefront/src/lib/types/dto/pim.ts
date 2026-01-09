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

// 가격 규칙 응답
export interface PricingRulesResponseDto {
  base_price: PricingRuleDto[]
  membership_price: PricingRuleDto[]
  tiered_price: PricingRuleDto[]
}

// 가격 계산 요청
export interface CalculatePriceRequestDto {
  variantId: string
  quantity: number
  customerType?: "regular" | "membership"
}

// 적용된 가격 규칙
export interface AppliedRuleDto {
  ruleId: string
  layer: string
  order: number
  scopeType: string
  operationType: string
  operationValue: number
  priceBeforeRule: number
  priceAfterRule: number
}

// 가격 계산 응답
export interface CalculatePriceResponseDto {
  variantId: string
  price: number
  totalPrice: number
  appliedRules: AppliedRuleDto[]
  priceBreakdown: {
    initialPrice: number
    afterBasePrice: number
    afterMembershipPrice: number
    afterTieredPrice: number
  }
}

// 가격 세트 DTO
export interface VariantPriceSetDto {
  basePrice: number
  membershipPrice: number
  tieredPrices: Array<{
    minQuantity: number
    price: number
  }>
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

// 태그 필터 DTO
export interface TagFilterDto {
  groupId: string
  valueIds: string[]
}

// 상품 태그 DTO
export interface ProductTagDto {
  group_id: string
  group_name: string
  value_id: string
  value_name: string
}

// 검색 결과 상품 아이템
export interface ProductSearchItemDto {
  master_id: string
  product_id: string
  version: number
  name: string
  description: string | null
  product_code: string | null
  brand: string | null
  status: string
  approval_status: string | null
  price: number | null
  category_id: string | null
  category_name: string | null
  category_path: string | null
  tags: ProductTagDto[]
  created_at: string
  updated_at: string
  _score?: number
}

// 페이지네이션 DTO
export interface PaginationDto {
  page: number
  limit: number
  total: number
  totalPages: number
}

// 태그 값 집계 DTO
export interface TagValueAggregationDto {
  value_id: string
  value_name: string
  count: number
}

// 태그 그룹 집계 DTO
export interface TagGroupAggregationDto {
  group_id: string
  group_name: string
  values: TagValueAggregationDto[]
}

// 검색 집계 DTO
export interface SearchAggregationsDto {
  tags?: TagGroupAggregationDto[]
}

// 검색 응답 DTO
export interface ProductSearchResponseDto {
  items: ProductSearchItemDto[]
  pagination: PaginationDto
  aggregations?: SearchAggregationsDto
}
