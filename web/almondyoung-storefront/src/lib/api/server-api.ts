import "server-only"

import { cookies as nextCookies } from "next/headers"
import { ApiAuthError, ApiError, ApiNetworkError } from "./api-error"

export interface ServerApiOptions extends RequestInit {
  /**
   * body.data를 자동으로 추출할지 여부
   * @default true - body.data가 있으면 추출, 없으면 body 전체 반환
   */
  unwrapData?: boolean
}

export async function serverApi<T = any>(
  url: string,
  options?: ServerApiOptions
): Promise<T> {
  try {
    const cookies = await nextCookies()
    const { unwrapData = true, ...fetchOptions } = options || {}

    // 3.5초 타임아웃 설정 (서버 블로킹 방지)
    const res = await fetch(`${url}`, {
      ...fetchOptions,
      signal: fetchOptions?.signal || AbortSignal.timeout(35000),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookies.toString(),
        ...fetchOptions?.headers,
      },
    })

    if (res.status === 401) {
      throw new ApiAuthError()
    }

    const body = await res.json()
    if (!res.ok) {
      throw new ApiError(
        body.message || `요청 실패: ${res.status}`,
        res.status,
        body
      )
    }

    // unwrapData 옵션에 따라 처리
    if (unwrapData && body.data !== undefined) {
      return body.data
    }

    return body
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    // 타임아웃 에러
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new ApiError(
        "요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
        408,
        "Request Timeout"
      )
    }

    // 네트워크 에러
    if (error instanceof TypeError && error.message.includes("fetch failed")) {
      throw new ApiNetworkError()
    }
    throw error
  }
}
