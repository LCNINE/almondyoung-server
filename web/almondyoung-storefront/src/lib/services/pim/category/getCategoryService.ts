"use server"

import { getCategoryTree } from "@lib/api/pim/categories.server"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"

// 메모리 캐시 타입
type MemCache = { data: CategoryTreeNodeDto[]; at: number }
const _mem: { categories?: MemCache } = {}

// 캐시 TTL (5분)
const MEM_TTL_MS = 1000 * 60 * 5

export async function getAllCategoriesCached(): Promise<CategoryTreeNodeDto[]> {
  const isDev = process.env.NODE_ENV === "development"

  if (
    !isDev &&
    _mem.categories &&
    Date.now() - _mem.categories.at < MEM_TTL_MS
  ) {
    return _mem.categories.data
  }

  try {
    const result = await getCategoryTree()
    if ("error" in result) {
      console.error("[getCategoryTree] 에러:", result.error)
      return []
    }
    const data = result.data?.categories ?? []

    if (!isDev) {
      _mem.categories = { data, at: Date.now() }
    }
    return data
  } catch (error) {
    console.error("[getAllCategoriesCached] 에러:", error)
    return []
  }
}

// 캐시 무효화 함수 (필요시 사용)
export async function invalidateCategoriesCache(): Promise<void> {
  delete _mem.categories
}

// getAllCategories 별칭 (기존 코드 호환성을 위해)
export const getAllCategories = getAllCategoriesCached
