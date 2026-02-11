import { ApiAuthError, ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import { getBackendBaseUrl } from "@/lib/config/backend"
import { getAccessTokenFromCookie } from "@/lib/utils/auth"
import type { WishlistResponse } from "@lib/types/dto/users"

type WishlistToggleAction = "added" | "removed"

export interface WishlistToggleResult {
  action: WishlistToggleAction
  message?: string
  data?: WishlistResponse
}

const resolveData = <T>(payload: unknown): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

const request = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const baseUrl = getBackendBaseUrl("users")

  if (!baseUrl) {
    throw new ApiNetworkError(
      "Missing backend base URL for service: users",
      500,
      "BACKEND_DOMAIN_MISSING"
    )
  }

  const accessToken = getAccessTokenFromCookie()
  if (!accessToken) {
    throw new ApiAuthError("UNAUTHORIZED", 401, "UNAUTHORIZED")
  }

  const headers: HeadersInit = {
    ...init.headers,
    Authorization: `Bearer ${accessToken}`,
  }

  if (init.body && !(init.body instanceof FormData)) {
    ;(headers as Record<string, string>)["Content-Type"] = "application/json"
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
    })
  } catch {
    throw new ApiNetworkError("NETWORK_ERROR", 500, "NETWORK_ERROR")
  }

  const json = await response.json().catch(() => ({}))

  if (response.ok) {
    return resolveData<T>(json)
  }

  if (response.status === 401) {
    throw new ApiAuthError(
      (json as { message?: string })?.message ?? "인증이 필요합니다",
      401,
      "UNAUTHORIZED"
    )
  }

  throw new HttpApiError(
    (json as { message?: string })?.message ?? `요청 실패: ${response.status}`,
    response.status,
    response.statusText,
    json
  )
}

/**
 * 사용자의 위시리스트를 조회합니다
 */
export const getWishlist = async (): Promise<WishlistResponse[]> => {
  return request<WishlistResponse[]>("/wishlist", { method: "GET" })
}

/**
 * 상품을 위시리스트에 추가/제거합니다 (토글)
 */
export const toggleWishlist = async (
  productId: string
): Promise<WishlistToggleResult> => {
  return request<WishlistToggleResult>("/wishlist", {
    method: "POST",
    body: JSON.stringify({ productId }),
  })
}

/**
 * 위시리스트에 상품이 있는지 확인합니다
 */
export const getWishlistByProductId = async (
  productId: string
): Promise<WishlistResponse | null> => {
  const data = await request<WishlistResponse[]>(`/wishlist/${productId}`, {
    method: "GET",
  })

  return data[0] || null
}
