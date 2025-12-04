import type {
  CategoryTreeResponse,
  CategoryDetailResponse,
  CategoryResponse,
  CategoryPathResponse,
  CategoryTreeNode,
  ProductListResponse,
  ProductMasterDetailResponse,
  VariantListResponse,
  ProductSearchResponseDto,
  TagFilterDto,
} from "./pim-types"

const API_ENDPOINT = "/api/pim"

/**
 * 환경에 따른 Base URL 결정
 * 라우트 핸들러를 통해 호출하도록 설정
 * Server Component: Next.js 앱 URL (process.env.APP_URL 또는 기본값)
 * Client Component: 상대 경로 (Browser가 자동으로 Origin 처리)
 */
function getBaseUrl() {
  if (typeof window === "undefined") {
    // 서버 사이드: 라우트 핸들러를 사용하기 위해 Next.js 앱 URL 사용
    // APP_URL이 Next.js 앱 URL이어야 함 (백엔드 URL이 아님)
    // 없으면 빈 문자열로 상대 경로 사용 (같은 서버에서 실행되는 경우)
    return process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ""
  }
  // 클라이언트 사이드: 상대 경로 사용 (라우트 핸들러 자동 인식)
  return ""
}

/**
 * 공통 Fetch Wrapper
 */
async function fetchPim<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${API_ENDPOINT}${path}`

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      cache: "no-store", // SSR/CSR 최신 데이터 유지를 위해 no-store
      ...options,
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: "Unknown error" }))
      throw new Error(
        error.message || `PIM API Request Failed: ${res.status} ${res.statusText}`
      )
    }

    const data = await res.json()
    return data
  } catch (error) {
    throw error
  }
}

// --- API Functions ---

/**
 * 카테고리 트리 조회
 */
export async function getCategoryTree(
  maxDepth?: number
): Promise<CategoryTreeResponse> {
  const query = maxDepth !== undefined ? `?maxDepth=${maxDepth}` : ""
  return fetchPim<CategoryTreeResponse>(`/categories${query}`)
}

/**
 * 카테고리 상세 조회 (ID 기반)
 */
export async function getCategoryById(
  id: string
): Promise<CategoryDetailResponse> {
  return fetchPim<CategoryDetailResponse>(`/categories/${id}`)
}

/**
 * 하위 카테고리 조회
 */
export async function getChildCategories(
  id: string
): Promise<CategoryResponse[]> {
  return fetchPim<CategoryResponse[]>(`/categories/${id}/children`)
}

/**
 * 카테고리 경로 조회
 */
export async function getCategoryPath(
  id: string
): Promise<CategoryPathResponse> {
  return fetchPim<CategoryPathResponse>(`/categories/${id}/path`)
}

/**
 * [Helper] Slug로 카테고리 ID 찾기 및 상세 조회
 * 백엔드에 Slug 조회 API가 없다면, 트리를 조회해서 매핑해야 합니다.
 * 이 로직을 API 함수 내부에 캡슐화하여 컴포넌트를 깔끔하게 유지합니다.
 */
export async function getCategoryBySlug(
  slug: string
): Promise<CategoryDetailResponse | null> {
  try {
    // 1. 트리 조회 (전체 구조 파악)
    const tree = await getCategoryTree()

    // 2. 트리에서 Slug와 일치하는 노드 찾기 (DFS)
    const findNodeBySlug = (
      nodes: CategoryTreeNode[],
      targetSlug: string
    ): CategoryTreeNode | null => {
      for (const node of nodes) {
        if (node.slug === targetSlug) return node
        if (node.children) {
          const found = findNodeBySlug(node.children, targetSlug)
          if (found) return found
        }
      }
      return null
    }

    const targetNode = findNodeBySlug(tree.categories, slug)

    if (!targetNode) {
      return null
    }

    // 3. 찾은 ID로 상세 정보 조회
    return await getCategoryById(targetNode.id)
  } catch (error) {
    return null
  }
}

// ==========================================
// 제품 마스터 (Product Masters) API
// ==========================================

/**
 * 제품 마스터 목록 조회
 * GET /masters
 * 
 * @param params 쿼리 파라미터
 * @param signal AbortSignal (선택)
 * @returns 제품 마스터 목록 (가격 정보 없음)
 * 
 * TODO: 가격 정보가 필요하면 Variant 조회 또는 가격 계산 API 별도 호출 필요
 */
export async function getAllProductList(
  params?: {
    page?: number
    limit?: number
    status?: string
    categoryId?: string
    brand?: string
    search?: string
    versionStatus?: string
    includeAllVersions?: boolean
  },
  signal?: AbortSignal
): Promise<ProductListResponse> {
  console.log(`🚀 [getAllProductList] 호출:`, params)
  
  const queryParams = new URLSearchParams()
  
  if (params?.page) queryParams.set("page", params.page.toString())
  if (params?.limit) queryParams.set("limit", params.limit.toString())
  if (params?.status) queryParams.set("status", params.status)
  if (params?.categoryId) queryParams.set("categoryId", params.categoryId)
  if (params?.brand) queryParams.set("brand", params.brand)
  if (params?.search) queryParams.set("search", params.search)
  if (params?.versionStatus) queryParams.set("versionStatus", params.versionStatus)
  if (params?.includeAllVersions !== undefined) {
    queryParams.set("includeAllVersions", params.includeAllVersions.toString())
  }

  const query = queryParams.toString()
  const path = query ? `/masters?${query}` : "/masters"
  
  return fetchPim<ProductListResponse>(path, { signal })
}

/**
 * 카테고리별 제품 조회
 * GET /masters?categoryId=xxx
 * 
 * @param categoryId 카테고리 ID (빈 문자열이면 전체 조회)
 * @param params 쿼리 파라미터
 * @param signal AbortSignal (선택)
 * @returns 카테고리별 제품 목록
 */
export async function getPimCategoryProducts(
  categoryId: string,
  params?: {
    page?: number
    limit?: number
    status?: string
    brand?: string
    search?: string
  },
  signal?: AbortSignal
): Promise<ProductListResponse> {
  // categoryId가 빈 문자열이면 전체 조회 (categoryId 파라미터 제외)
  const queryParams = categoryId
    ? { ...params, categoryId }
    : params

  return getAllProductList(queryParams, signal)
}

/**
 * 제품 마스터 상세 조회
 * GET /masters/:id
 * 
 * @param id 제품 마스터 ID
 * @returns 제품 마스터 상세 정보
 */
export async function getPimProductDetail(
  id: string
): Promise<ProductMasterDetailResponse> {
  return fetchPim<ProductMasterDetailResponse>(`/masters/${id}`)
}

/**
 * 제품 Variant 조회
 * GET /variants/masters/:masterId?includePrice=true
 * 
 * @param masterId 제품 마스터 ID
 * @param options 옵션 (includePrice, status 등)
 * @param signal AbortSignal (선택)
 * @returns Variant 목록
 * 
 * TODO: includePrice=true 옵션 사용 시 가격 정보 포함 가능
 */
export async function getPimProductVariants(
  masterId: string,
  options?: {
    includePrice?: boolean
    status?: string
    page?: number
    limit?: number
  },
  signal?: AbortSignal
): Promise<VariantListResponse> {
  const queryParams = new URLSearchParams()
  
  if (options?.includePrice !== undefined) {
    queryParams.set("includePrice", options.includePrice.toString())
  }
  if (options?.status) queryParams.set("status", options.status)
  if (options?.page) queryParams.set("page", options.page.toString())
  if (options?.limit) queryParams.set("limit", options.limit.toString())

  const query = queryParams.toString()
  const path = query 
    ? `/variants/masters/${masterId}?${query}` 
    : `/variants/masters/${masterId}`
  
  return fetchPim<VariantListResponse>(path, { signal })
}

// ==========================================
// Elasticsearch 검색 API
// ==========================================

/**
 * Elasticsearch 기반 상품 검색
 * GET /products/search
 * 
 * @param params 검색 파라미터
 * @param signal AbortSignal (선택)
 * @returns 검색 결과
 */
export async function searchProducts(
  params?: {
    keyword?: string
    categoryId?: string
    brands?: string[]
    minPrice?: number
    maxPrice?: number
    status?: string
    tagFilters?: TagFilterDto[]
    sortBy?: "relevance" | "price" | "createdAt"
    sortOrder?: "asc" | "desc"
    page?: number
    limit?: number
  },
  signal?: AbortSignal
): Promise<ProductSearchResponseDto> {
  const queryParams = new URLSearchParams()
  
  if (params?.keyword) queryParams.set("keyword", params.keyword)
  if (params?.categoryId) queryParams.set("categoryId", params.categoryId)
  if (params?.brands && params.brands.length > 0) {
    params.brands.forEach((brand) => queryParams.append("brands", brand))
  }
  if (params?.minPrice !== undefined) queryParams.set("minPrice", params.minPrice.toString())
  if (params?.maxPrice !== undefined) queryParams.set("maxPrice", params.maxPrice.toString())
  if (params?.status) queryParams.set("status", params.status)
  if (params?.tagFilters && params.tagFilters.length > 0) {
    params.tagFilters.forEach((filter, index) => {
      queryParams.set(`tagFilters[${index}][groupId]`, filter.groupId)
      filter.valueIds.forEach((valueId, valueIndex) => {
        queryParams.append(`tagFilters[${index}][valueIds][]`, valueId)
      })
    })
  }
  if (params?.sortBy) queryParams.set("sortBy", params.sortBy)
  if (params?.sortOrder) queryParams.set("sortOrder", params.sortOrder)
  if (params?.page) queryParams.set("page", params.page.toString())
  if (params?.limit) queryParams.set("limit", params.limit.toString())

  const query = queryParams.toString()
  const path = query ? `/products/search?${query}` : "/products/search"
  
  return fetchPim<ProductSearchResponseDto>(path, { signal })
}
