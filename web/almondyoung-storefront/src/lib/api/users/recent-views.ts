import {
  RecentViewDto,
  AddToRecentViewsDto,
  RecentViewsResponseDto,
} from "@lib/types/dto/user"
import { clientApi } from "@lib/client-api"
import { USER_API_CONFIG, USER_API_ENDPOINTS } from "@lib/api/users/config"

/**
 * 최근 본 상품 추가
 */
export async function addToRecentViews(
  productId: string
): Promise<RecentViewDto> {
  console.log("🌐 [addToRecentViews] API 호출 시작:", { productId })

  try {
    const data = await clientApi(
      USER_API_CONFIG.BASE_URL + USER_API_ENDPOINTS.RECENT_VIEWS,
      {
        method: "POST",
        body: JSON.stringify({ productId }),
      }
    )

    console.log("✅ [addToRecentViews] 성공:", data)
    return data
  } catch (err) {
    console.error("❌ [addToRecentViews] 에러:", err)
    throw err
  }
}

/**
 * 최근 본 상품 목록 조회
 */
export async function getRecentViews(
  limit: number = 10
): Promise<RecentViewDto[]> {
  console.log("🌐 [getRecentViews] API 호출 시작:", { limit })

  try {
    const data = await clientApi(
      USER_API_CONFIG.BASE_URL +
        USER_API_ENDPOINTS.RECENT_VIEWS +
        `?limit=${limit}`
    )

    console.log("✅ [getRecentViews] 성공:", data)

    // API가 배열을 반환하거나 items 속성이 있는 경우 처리
    if (Array.isArray(data)) {
      return data
    }

    if (data && typeof data === "object" && "items" in data) {
      return (data as RecentViewsResponseDto).items
    }

    return []
  } catch (err) {
    console.error("❌ [getRecentViews] 에러:", err)
    throw err
  }
}

/**
 * 최근 본 상품 제거
 */
export async function removeFromRecentViews(
  recentViewId: string
): Promise<{ success: boolean; message: string }> {
  console.log("🌐 [removeFromRecentViews] API 호출 시작:", { recentViewId })

  try {
    const data = await clientApi(
      USER_API_CONFIG.BASE_URL +
        USER_API_ENDPOINTS.RECENT_VIEWS_BY_ID(recentViewId),
      {
        method: "DELETE",
      }
    )

    console.log("✅ [removeFromRecentViews] 성공:", data)
    return data
  } catch (err) {
    console.error("❌ [removeFromRecentViews] 에러:", err)
    throw err
  }
}
