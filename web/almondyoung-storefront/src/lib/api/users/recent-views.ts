import {
  RecentViewDto,
  RecentViewsResponseDto,
} from "@lib/types/dto/user"
import { ApiAuthError, HttpApiError } from "@lib/api/api-error"

/**
 * 최근 본 상품 추가
 */
export async function addToRecentViews(
  productId: string
): Promise<RecentViewDto> {
  console.log("🌐 [addToRecentViews] API 호출 시작:", { productId })

  const response = await fetch(`/api/users/recent-views`, {
    method: "POST",
    body: JSON.stringify({ productId }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  })

  const data = await response.json()

  if (!response.ok) {
    console.error("❌ [addToRecentViews] 에러:", data)

    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }

    throw new HttpApiError(
      data.message || "Failed to add recent view",
      response.status,
      response.statusText,
      data
    )
  }

  console.log("✅ [addToRecentViews] 성공:", data)
  return data
}

/**
 * 최근 본 상품 목록 조회
 */
export async function getRecentViews(
  limit: number = 10
): Promise<RecentViewDto[]> {
  console.log("🌐 [getRecentViews] API 호출 시작:", { limit })

  const response = await fetch(`/api/users/recent-views?limit=${limit}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  })

  const data = await response.json()

  if (!response.ok) {
    console.error("❌ [getRecentViews] 에러:", data)

    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }

    throw new HttpApiError(
      data.message || "Failed to get recent views",
      response.status,
      response.statusText,
      data
    )
  }

  console.log("✅ [getRecentViews] 성공:", data)

  // API가 배열을 반환하거나 items 속성이 있는 경우 처리
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object" && "items" in data) {
    return (data as RecentViewsResponseDto).items
  }

  return []
}

/**
 * 최근 본 상품 제거
 */
export async function removeFromRecentViews(
  recentViewId: string
): Promise<{ success: boolean; message: string }> {
  console.log("🌐 [removeFromRecentViews] API 호출 시작:", { recentViewId })

  const response = await fetch(`/api/users/recent-views/${recentViewId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  })

  const data = await response.json()

  if (!response.ok) {
    console.error("❌ [removeFromRecentViews] 에러:", data)

    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }

    throw new HttpApiError(
      data.message || "Failed to remove recent view",
      response.status,
      response.statusText,
      data
    )
  }

  console.log("✅ [removeFromRecentViews] 성공:", data)
  return data
}
