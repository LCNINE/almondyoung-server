/**
 * PIM API 타입 정의
 * 서버의 DTO 구조를 정확히 반영합니다.
 * 스키마에 있지만 DTO에 명시되지 않은 필드(imageUrl)는 optional로 추가했습니다.
 */

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
  // 메인 반영 여부 (서버 응답에 있을 수 있음)
  showInMain?: boolean
  isMain?: boolean
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
 * 
 * TODO: 가격 정보는 포함되지 않음
 * - 가격이 필요하면 Variant 조회 시 includePrice=true 옵션 사용
 * - 또는 가격 계산 API 별도 호출 필요
 */
export interface ProductMasterListItem {
  id: string
  name: string
  description?: string | null
  brand?: string | null
  basePrice: number // TODO: 실제로는 가격 정보가 없을 수 있음
  status: "draft" | "active" | "inactive" | null
  isWholesaleOnly?: boolean
  isMembershipOnly?: boolean
  thumbnail?: string | null
  optionGroupCount?: number
  variantCount?: number
  createdAt?: string | null
  updatedAt?: string | null
  // TODO: 가격 정보 (price, membershipPrice 등)는 Variant 조회 또는 가격 계산 API로 별도 조회 필요
}

/**
 * 제품 마스터 상세 응답
 * GET /masters/:id 응답 구조
 */
export interface ProductMasterDetailResponse {
  id: string
  name: string
  description?: string | null
  brand?: string | null
  basePrice: number
  status: "draft" | "active" | "inactive" | null
  isWholesaleOnly?: boolean
  isMembershipOnly?: boolean
  images?: {
    primary?: {
      id: string
      url: string
      originalName?: string
      fileName?: string
      mimeType?: string
      size?: number
    } | null
    additional?: Array<{
      id: string
      url: string
      originalName?: string
      fileName?: string
      sortOrder?: number
    }>
  }
  optionGroups?: Array<{
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
  }>
  variants?: ProductVariantResponse[]
  channelProducts?: any[]
  // TODO: 가격 정보는 Variant 조회 또는 가격 계산 API로 별도 조회 필요
}

/**
 * 제품 Variant 응답
 * GET /variants/masters/:masterId?includePrice=true 응답 구조
 * 
 * TODO: includePrice=true 옵션 사용 시 가격 정보 포함 가능
 */
export interface ProductVariantResponse {
  id: string
  masterId: string
  sku?: string
  options?: Record<string, string> // 예: { "색상": "빨강", "사이즈": "M" }
  price?: number // TODO: includePrice=true 옵션 사용 시 포함됨
  status?: "active" | "inactive" | null
  // TODO: 가격 계산 API로 더 정확한 가격 정보 조회 가능
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