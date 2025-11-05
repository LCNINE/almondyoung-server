import { PIM_API_CONFIG } from "@lib/api/pim/config"
import type { PimCategory } from "@lib/types/dto/pim"

// 메모리 캐시 타입
type MemCache = { data: PimCategory[]; at: number }
const _mem: { categories?: MemCache } = {}

// 캐시 TTL (5분)
const MEM_TTL_MS = 1000 * 60 * 5

export async function getAllCategoriesCached(): Promise<PimCategory[]> {
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

// Next.js ISR 캐시를 적용한 API 호출
async function fetchCategoriesWithISR(): Promise<PimCategory[]> {
  try {
    // ⚡ 3초 타임아웃 설정 (RootLayout 블로킹 방지)
    const res = await fetch(`${PIM_API_CONFIG.BASE_URL}/categories`, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      signal: AbortSignal.timeout(3000), // Next.js 15 권장
      next: {
        revalidate: 60 * 60 * 6, // 6시간
        tags: ["categories"],
      },
      cache: "no-store", // 브라우저 새로고침시 실제 API 호출
    })

    if (!res.ok) {
      console.warn(
        `[fetchCategoriesWithISR] API 요청 실패: ${res.status} ${res.statusText}`
      )
      return [] // 🛡️ Graceful degradation: 빈 배열 반환
    }

    const json = await res.json()
    const categories = json?.categories ?? []
    console.log(
      `✅ [fetchCategoriesWithISR] ${categories.length}개 카테고리 로드 완료`
    )
    return categories
  } catch (error) {
    // 타임아웃, 네트워크 에러 등 모든 에러 처리
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      console.warn(
        "[fetchCategoriesWithISR] 타임아웃 (3초 초과) - 빈 배열 반환"
      )
    } else {
      console.error("[fetchCategoriesWithISR] 에러 발생:", error)
    }
    return [] // 🛡️ 항상 빈 배열 반환 (앱 크래시 방지)
  }
}

// 캐시 무효화 함수 (필요시 사용)
export function invalidateCategoriesCache(): void {
  delete _mem.categories
  console.log("🌐 [invalidateCategoriesCache] 메모리 캐시 무효화")
}

// getAllCategories 별칭 (기존 코드 호환성을 위해)
export const getAllCategories = getAllCategoriesCached
