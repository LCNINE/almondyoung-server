/**
 * PIM API 클라이언트
 * 라우트 핸들러를 통해 백엔드 API를 호출합니다.
 */

import type {
  CategoryTreeResponse,
  CategoryDetailResponse,
  CategoryResponse,
  CategoryPathResponse,
} from "./pim-types"

const API_BASE = "/api/pim"

/**
 * 카테고리 트리 조회
 * @param maxDepth 최대 깊이 (선택)
 */
export async function getCategoryTree(
  maxDepth?: number
): Promise<CategoryTreeResponse> {
  const params = new URLSearchParams()
  if (maxDepth !== undefined) {
    params.append("maxDepth", maxDepth.toString())
  }

  const url = `${API_BASE}/categories${params.toString() ? `?${params.toString()}` : ""}`

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to fetch category tree: ${res.statusText}`
    )
  }

  return res.json()
}

/**
 * 카테고리 상세 조회
 * @param id 카테고리 ID
 */
export async function getCategoryById(
  id: string
): Promise<CategoryDetailResponse> {
  const res = await fetch(`${API_BASE}/categories/${id}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to fetch category: ${res.statusText}`
    )
  }

  return res.json()
}

/**
 * 하위 카테고리 조회
 * @param id 부모 카테고리 ID
 */
export async function getChildCategories(
  id: string
): Promise<CategoryResponse[]> {
  const res = await fetch(`${API_BASE}/categories/${id}/children`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to fetch child categories: ${res.statusText}`
    )
  }

  return res.json()
}

/**
 * 카테고리 경로 조회
 * @param id 카테고리 ID
 */
export async function getCategoryPath(
  id: string
): Promise<CategoryPathResponse> {
  const res = await fetch(`${API_BASE}/categories/${id}/path`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(
      error.message || `Failed to fetch category path: ${res.statusText}`
    )
  }

  return res.json()
}
