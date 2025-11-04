import { useState, useCallback } from "react"
import { RecentViewProductThumbnail } from "@lib/types/ui/product"
import { UserBasicInfo } from "@lib/types/ui/user"

// 더미 데이터 import
import hairListData from "@lib/data/dummy/get-hair-list.json"

interface UseRecentViewsOptions {
  userId?: string
  initialLimit?: number
  useCache?: boolean
  refreshInterval?: number
  autoAdd?: {
    productId?: string
    delay?: number
    addOnce?: boolean
  }
}

interface UseRecentViewsReturn {
  recentViews: RecentViewProductThumbnail[]
  isLoading: boolean
  error: string | null
  removeProduct: (productId: string) => Promise<void>
  refresh: () => Promise<void>
  clearCache: () => void
  hasItems: boolean
}

/**
 * 최근 본 상품 관리 Hook (더미 버전 - 더미 JSON 사용)
 *
 * 개발 단계에서는 get-hair-list.json에서 3개만 가져와서 반환
 * 추후 API 연동 시 실제 로직 추가 예정
 */
export function useRecentViews(
  user: UserBasicInfo | null,
  options: UseRecentViewsOptions = {}
): UseRecentViewsReturn {
  // 더미 데이터 변환: 3개만 가져오기
  const dummyRecentViews: RecentViewProductThumbnail[] = hairListData.data
    .slice(0, 3)
    .map((item) => ({
      productId: item.id,
      viewedAt: item.createdAt,
      thumbnail: item.thumbnail,
    }))

  const [recentViews] = useState<RecentViewProductThumbnail[]>(dummyRecentViews)
  const [isLoading] = useState(false)
  const [error] = useState<string | null>(null)

  // 더미 함수들 - 아무 동작도 하지 않음
  const removeProduct = useCallback(async (productId: string) => {
    // API 연동 시 구현
  }, [])

  const refresh = useCallback(async () => {
    // API 연동 시 구현
  }, [])

  const clearCache = useCallback(() => {
    // API 연동 시 구현
  }, [])

  return {
    recentViews,
    isLoading,
    error,
    removeProduct,
    refresh,
    clearCache,
    hasItems: recentViews.length > 0,
  }
}

/**
 * 최근 본 상품 존재 여부만 확인하는 간단한 Hook (더미 버전)
 */
export function useHasRecentViews(userId?: string): boolean {
  return false
}
