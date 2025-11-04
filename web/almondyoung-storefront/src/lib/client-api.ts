"use client"

import { ApiError } from "./api-error"

if (!process.env.NEXT_PUBLIC_BACKEND_URL) {
  throw new Error("NEXT_PUBLIC_BACKEND_URL is not defined")
}

let refreshPromise: Promise<boolean> | null = null

async function refreshToken(): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch(`/api/auth/restore-token`, {
        method: "POST",
        credentials: "include",
      })
      return res.ok
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export async function clientApi<T = any>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  async function executeRequest(retry = true): Promise<T> {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL
    const url = backendUrl ? `${backendUrl}${endpoint}` : `/api${endpoint}`
    
    // body가 있는 경우에만 Content-Type 헤더 추가
    const hasBody = options?.body && options.body !== ""
    const headers: Record<string, string> = {
      ...(options?.headers as Record<string, string> || {}),
    }
    
    if (hasBody) {
      headers["Content-Type"] = "application/json"
    }
    
    // ngrok 호환성을 위한 헤더
    if (backendUrl?.includes("ngrok")) {
      headers["ngrok-skip-browser-warning"] = "true"
    }
    
    const res = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    })

    if (res.status === 401 && retry) {
      // 쿠키 기반 인증에서는 단순히 재시도
      const refreshed = await refreshToken()
      if (refreshed) {
        return executeRequest(false)
      }

      // 인증 실패 시 로그인 페이지로 리다이렉트
      if (typeof window !== 'undefined') {
        const currentPath = window.location.pathname
        const countryCode = currentPath.split('/')[1] || 'kr'
        window.location.href = `/${countryCode}/auth/login`
      }
      
      throw new Error("authentication expired")
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
  }

  return executeRequest()
}
