/**
 * PIM API 타입 정의
 * 서버의 DTO 구조를 정확히 반영합니다.
 * 스키마에 있지만 DTO에 명시되지 않은 필드(imageUrl)는 optional로 추가했습니다.
 */

// 카테고리 표시 설정 (display_settings JSON 파싱용)
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

// 카테고리 트리 노드 (트리 조회용)
// 서버의 CategoryTreeNodeDto 구조
export interface CategoryTreeNode {
  id: string
  name: string
  description: string | null
  slug: string
  level: number
  path: string
  sortOrder: number
  isActive: boolean
  productCount?: number
  children?: CategoryTreeNode[]
  // 스키마에 있지만 DTO에 명시되지 않은 필드
  imageUrl?: string | null
  // 표시 설정 (이미 파싱된 객체, camelCase)
  displaySettings?: CategoryDisplaySettings | null
  // 하위 호환성을 위한 필드 (JSON 문자열, snake_case)
  display_settings?: string | null
}

// 카테고리 트리 응답
// 서버의 CategoryTreeResponseDto 구조
export interface CategoryTreeResponse {
  categories: CategoryTreeNode[]
  totalCount: number
  maxDepth: number
}

// 카테고리 기본 응답 (일반 조회용)
// 서버의 CategoryResponseDto 구조
export interface CategoryResponse {
  id: string
  name: string
  description: string | null
  slug: string
  parentId: string | null
  level: number
  path: string
  sortOrder: number
  isActive: boolean
  createdAt: Date | string
  updatedAt: Date | string
  childCount?: number
  productCount?: number
  thumbnail?: string | null
  basePrice?: string | null
  // 스키마에 있지만 DTO에 명시되지 않은 필드
  imageUrl?: string | null
  // 표시 설정 (JSON 문자열)
  display_settings?: string | null
}

// 카테고리 상세 응답
// 서버의 CategoryDetailResponseDto 구조
export interface CategoryDetailResponse {
  id: string
  name: string
  description: string | null
  slug: string
  parentId: string | null
  level: number
  path: string
  sortOrder: number
  isActive: boolean
  createdAt: Date | string
  updatedAt: Date | string
  parent?: CategoryResponse
  children: CategoryResponse[]
  productCount: number
  totalProductCount: number
  // 스키마에 있지만 DTO에 명시되지 않은 필드
  imageUrl?: string | null
}

// 카테고리 경로 정보
// 서버의 CategoryPathInfoDto 구조
export interface CategoryPathInfo {
  id: string
  name: string
  slug: string
  level: number
}

// 카테고리 경로 응답
// 서버의 CategoryPathResponseDto 구조
export interface CategoryPathResponse {
  categoryId: string
  path: CategoryPathInfo[]
  fullPath: string
}

// 프론트엔드에서 사용하는 통합 카테고리 타입
// 트리 노드와 일반 응답을 모두 포함할 수 있도록 확장
export type PimCategory = CategoryTreeNode | CategoryResponse

// ==========================================
// 제품 마스터 (Product Masters) 타입
// ==========================================

/**
 * 제품 마스터 목록 아이템
 * GET /masters 응답 구조
 */
export interface ProductMasterListItem {
  id: string
  name: string
  description?: string | null
  brand?: string | null
  // 가격 정보 (optional - Pricing API로 별도 조회 가능)
  basePrice?: number | null
  membershipPrice?: number | null
  // 상태 정보
  status: "draft" | "active" | "inactive" | string | null
  isWholesaleOnly?: boolean | null
  isMembershipOnly?: boolean | null
  // 썸네일
  thumbnail?: string | null
  // 옵션/변형 카운트
  optionGroupCount?: number
  variantCount?: number
  // 태그
  tags?: string[] | null
  // 타임스탬프
  createdAt?: string | null
  updatedAt?: string | null
}

/**
 * 리뷰 요약 정보 (transformer에서 사용)
 */
export interface ReviewSummary {
  rating?: number
  reviewCount?: number
  qnaCount?: number
}

/**
 * 제품 마스터 상세 응답
 * GET /masters/:id 응답 구조
 * 문서의 MasterDetailDto 기준으로 정의
 */
export interface ProductMasterDetailResponse {
  id: string
  name: string
  description?: string | null
  brand?: string | null
  // 가격 정보 (optional - Pricing API로 별도 조회 가능)
  basePrice?: number | null
  membershipPrice?: number | null
  // 상태 정보
  status: "draft" | "active" | "inactive" | string | null
  isWholesaleOnly?: boolean | null
  isMembershipOnly?: boolean | null
  // 마케팅/메타 정보
  tags?: string[] | null
  attributes?: Record<string, any> | null
  // SEO 정보
  seoTitle?: string | null
  seoDescription?: string | null
  seoKeywords?: string[] | null
  // 상세 설명 HTML
  descriptionHtml?: string | null
  // 썸네일 (목록/상세 공통)
  thumbnail?: string | null
  // 이미지 (유연한 구조)
  images?: any
  // 옵션 그룹
  optionGroups?: PimOptionGroup[]
  // Variant 목록
  variants?: PimVariant[]
  // 채널 제품
  channelProducts?: any[]
  // 태그 값 (태그 그룹/값 상세)
  tagValues?: ProductTagDto[]
  // 리뷰 요약 (transformer에서 사용)
  reviewSummary?: ReviewSummary | null
  // 타임스탬프
  createdAt?: Date | string | null
  updatedAt?: Date | string | null
  createdBy?: string | null
  updatedBy?: string | null
}

/**
 * 제품 Variant 응답
 * GET /variants/masters/:masterId?includePrice=true 응답 구조
 * 문서의 VariantWithPriceDto 기준으로 정의
 */
export interface ProductVariantResponse {
  id: string
  masterId: string
  // 변형명 (문서 기준)
  variantName?: string | null
  // SKU (하위 호환성 유지)
  sku?: string
  // 옵션 (하위 호환성)
  options?: Record<string, string>
  // 옵션 값 배열 (문서 기준 - transformer에서 사용)
  optionValues?: Array<{
    optionGroupId?: string
    optionValueId?: string
    value?: string
    label?: string
  }>
  // 이미지
  images?: any
  // 표시 순서 (문서 기준)
  displayOrder?: number | null
  // 상태
  status?: "active" | "inactive" | string | null
  // 기본 변형 여부 (문서 기준)
  isDefault?: boolean | null
  // 가격 (includePrice=true 시 포함)
  price?: number
  // 가격 조정 (옵션 추가금)
  priceAdjustment?: number
  // 타임스탬프 (문서 기준)
  createdAt?: Date | string | null
  updatedAt?: Date | string | null
}

/**
 * 제품 목록 응답 (페이지네이션 포함)
 * GET /masters 응답 구조
 */
export interface ProductListResponse {
  items: ProductMasterListItem[]
  total: number
  page: number
  limit: number
  totalPages?: number
}

/**
 * Variant 목록 응답
 * GET /variants/masters/:masterId 응답 구조
 */
export interface VariantListResponse {
  items: ProductVariantResponse[]
  total: number
  page: number
  limit: number
}

// ==========================================
// 타입 별칭 (기존 코드 호환성)
// ==========================================

/**
 * 기존 transformer와의 호환성을 위한 타입 별칭
 * @deprecated ProductMasterListItem 사용 권장
 */
export type PimProductListItem = ProductMasterListItem

/**
 * 기존 transformer와의 호환성을 위한 타입 별칭
 * @deprecated ProductMasterDetailResponse 사용 권장
 */
export type PimProductDetail = ProductMasterDetailResponse

/**
 * 옵션 그룹 타입 (transformer에서 사용)
 */
export interface PimOptionGroup {
  id: string
  name: string
  displayName?: string
  sortOrder?: number
  values?: Array<{
    id: string
    value: string
    displayName?: string
    sortOrder?: number
    isActive?: boolean
  }>
}

/**
 * Variant 타입 (transformer에서 사용)
 */
export interface PimVariant {
  id: string
  variantName?: string
  priceAdjustment?: number
  status?: "active" | "inactive" | null
  optionValues?: Array<{
    optionGroupId?: string
    optionValueId?: string
    value?: string
    label?: string
  }>
}

// ==========================================
// Elasticsearch 검색 API 타입
// ==========================================

/**
 * 태그 필터 DTO
 * 그룹 간 AND, 그룹 내 OR 조건
 */
export interface TagFilterDto {
  groupId: string
  valueIds: string[]
}

/**
 * 상품 태그 DTO
 */
export interface ProductTagDto {
  group_id: string
  group_name: string
  value_id: string
  value_name: string
}

/**
 * 검색 결과 상품 아이템 DTO
 */
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

/**
 * 페이지네이션 DTO
 */
export interface PaginationDto {
  page: number
  limit: number
  total: number
  totalPages: number
}

/**
 * 태그 값 집계 DTO
 */
export interface TagValueAggregationDto {
  value_id: string
  value_name: string
  count: number
}

/**
 * 태그 그룹 집계 DTO
 */
export interface TagGroupAggregationDto {
  group_id: string
  group_name: string
  values: TagValueAggregationDto[]
}

/**
 * 검색 집계 DTO
 */
export interface SearchAggregationsDto {
  tags?: TagGroupAggregationDto[]
}

/**
 * 검색 응답 DTO
 */
export interface ProductSearchResponseDto {
  items: ProductSearchItemDto[]
  pagination: PaginationDto
  aggregations?: SearchAggregationsDto
}