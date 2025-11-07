"use client"

import { ApiAuthError, ApiError } from "./api-error"
import { USER_API_CONFIG } from "./api/users/config"

let refreshPromise: Promise<boolean> | null = null

async function refreshToken(): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch(
        `${USER_API_CONFIG.BASE_URL}/auth/restore-token`,
        {
          method: "POST",
          credentials: "include",
          signal: AbortSignal.timeout(5000),
        }
      )
      return res.ok
    } catch (error) {
      console.error("Token refresh failed:", error)
      return false
    } finally {
      setTimeout(() => {
        refreshPromise = null
      }, 100)
    }
  })()

  return refreshPromise
}

export async function clientApi<T = any>(
  url: string,
  options?: RequestInit
): Promise<T> {
  async function executeRequest(retry = true): Promise<T> {
    const hasBody = options?.body && options.body !== ""
    const headers: Record<string, string> = {
      ...((options?.headers as Record<string, string>) || {}),
    }

    if (hasBody) {
      headers["Content-Type"] = "application/json"
    }

    try {
      const res = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
      })

      if (res.status === 401 && retry) {
        const refreshed = await refreshToken()

        if (refreshed) {
          return executeRequest(false)
        }

        // 리프레시 실패 → 로그인 페이지로
        if (typeof window !== "undefined") {
          const currentPath = window.location.pathname
          const countryCode = currentPath.split("/")[1] || "kr"
          window.location.href = `/${countryCode}/login`
        }

        // ApiAuthError 던지기
        throw new ApiAuthError(
          "UNAUTHORIZED",
          401,
          res.statusText || "UNAUTHORIZED"
        )
      }

      // JSON 파싱 (204 No Content 제외)
      let body: any
      if (res.status !== 204) {
        const text = await res.text()
        try {
          body = text ? JSON.parse(text) : {}
        } catch {
          // JSON 파싱 실패 시 원본 텍스트 사용
          body = { message: text }
        }
      }

      if (!res.ok) {
        // ApiError 던지기 (statusText 포함)
        throw new ApiError(
          body?.message || `요청 실패: ${res.status}`,
          res.status,
          res.statusText || String(res.status),
          body
        )
      }

      return body?.data || body
    } catch (error) {
      // 이미 ApiError 계열이면 그대로 throw
      if (error instanceof ApiError) {
        throw error
      }

      // 네트워크 에러 → ApiError로 변환
      const errorMessage =
        error instanceof Error ? error.message : "Network Error"
      throw new ApiError(errorMessage, 0, "NETWORK_ERROR")
    }
  }

  return executeRequest()
}
