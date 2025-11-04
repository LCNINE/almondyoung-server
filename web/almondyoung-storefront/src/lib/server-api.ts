import { cookies as nextCookies } from "next/headers"
import "server-only"
import { ApiError } from "./api-error"

if (!process.env.NEXT_PUBLIC_BACKEND_URL) {
  throw new Error("NEXT_PUBLIC_BACKEND_URL is not defined")
}

export async function serverApi<T = any>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  try {
    const cookies = await nextCookies()

    // ⚡ 3초 타임아웃 설정 (서버 블로킹 방지)
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL
    
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}${endpoint}`,
      {
        ...options,
        signal: options?.signal || AbortSignal.timeout(3000),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookies.toString(),
          ...options?.headers,
        },
      }
    )

    if (res.status === 401) {
      throw new ApiError("UNAUTHORIZED", 401, "UNAUTHORIZED")
    }

    const body = await res.json()
    if (!res.ok) {
      throw new ApiError(
        body.message || `요청 실패: ${res.status}`,
        res.status,
        body
      )
    }

    return body.data || body
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
      throw new ApiError("Network Error", 500, "Network Error")
    }
    throw error
  }
}
