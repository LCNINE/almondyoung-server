import { getCategoryTree } from "@lib/api/pim/categories.server"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"

// 메모리 캐시 타입
type MemCache = { data: CategoryTreeNodeDto[]; at: number }
const _mem: { categories?: MemCache } = {}

// 캐시 TTL (5분)
const MEM_TTL_MS = 1000 * 60 * 5

export async function getAllCategoriesCached(): Promise<CategoryTreeNodeDto[]> {
  // 개발 환경에서는 캐시 비활성화 (디버깅을 위해)
  const isDev = process.env.NODE_ENV === "development"

  // 1) 메모리 캐시 확인 (프로덕션에서만)
  if (
    !isDev &&
    _mem.categories &&
    Date.now() - _mem.categories.at < MEM_TTL_MS
  ) {
    return _mem.categories.data
  }

  // 2) API 호출 (Next.js ISR 캐시 적용)
  const data = await fetchCategoriesWithISR()

  // 3) 메모리 캐시에 저장 (프로덕션에서만)
  if (!isDev) {
    _mem.categories = { data, at: Date.now() }
  }
  return data
}

// 서버 액션을 통한 API 호출
async function fetchCategoriesWithISR(): Promise<CategoryTreeNodeDto[]> {
  try {
    // 서버 액션을 통해 백엔드 API 호출
    const result = await getCategoryTree()
    if ("error" in result) {
      console.error("[getCategoryTree] 에러:", result.error)
      return []
    }
    const categories = result.data?.categories ?? []
    return categories
  } catch (error) {
    // 타임아웃, 네트워크 에러 등 모든 에러 처리
    console.error("[fetchCategoriesWithISR] 에러:", error)
    return [] // 🛡️ 항상 빈 배열 반환 (앱 크래시 방지)
  }
}

// 캐시 무효화 함수 (필요시 사용)
export function invalidateCategoriesCache(): void {
  delete _mem.categories
}

// getAllCategories 별칭 (기존 코드 호환성을 위해)
export const getAllCategories = getAllCategoriesCached
