import type {
  CategoryTreeResponse,
  CategoryDetailResponse,
  CategoryResponse,
  CategoryPathResponse,
  CategoryTreeNode,
} from "./pim-types"

const API_ENDPOINT = "/api/pim"

/**
 * 환경에 따른 Base URL 결정
 * Server Component: http://localhost:3000 (process.env.APP_URL)
 * Client Component: 상대 경로 (Browser가 자동으로 Origin 처리)
 */
function getBaseUrl() {
  if (typeof window === "undefined") {
    // 서버 사이드 실행 시 절대 경로 필요
    return process.env.APP_URL || ""
  }
  // 클라이언트 사이드 실행 시 상대 경로 사용
  return ""
}

/**
 * 공통 Fetch Wrapper
 */
async function fetchPim<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${API_ENDPOINT}${path}`

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

  return res.json()
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
      console.warn(`[PIM API] Category not found for slug: ${slug}`)
      return null
    }

    // 3. 찾은 ID로 상세 정보 조회
    return await getCategoryById(targetNode.id)
  } catch (error) {
    console.error(`[PIM API] Error finding category by slug:`, error)
    return null
  }
}
