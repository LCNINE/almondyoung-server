"use server"

import { unlinkIdentity } from "@/lib/api/users/auth/identities"
import { getBackendBaseUrl } from "@/lib/config/backend"
import { ApiAuthError, HttpApiError } from "@lib/api/api-error"
import { getAccessToken } from "@lib/data/cookies"
import type { SocialProviderDto } from "@/lib/types/dto/social-identity"

export interface LinkActionResult {
  success: boolean
  error?: string
  redirectUrl?: string
}

export async function linkSocialAccountAction(
  provider: SocialProviderDto,
  redirectTo: string
): Promise<LinkActionResult> {
  const accessToken = await getAccessToken()

  if (!accessToken) {
    return { success: false, error: "로그인이 필요합니다." }
  }

  const baseUrl = getBackendBaseUrl("users")
  const backendUrl = `${baseUrl}/auth/link/${provider}?redirectTo=${encodeURIComponent(redirectTo)}`

  try {
    const response = await fetch(backendUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      redirect: "manual",
    })

    if (response.status === 302 || response.status === 301) {
      const location = response.headers.get("Location")
      if (location) {
        return { success: true, redirectUrl: location }
      }
    }

    if (response.status === 401) {
      throw new ApiAuthError()
    }

    const data = await response.json().catch(() => ({}))
    return {
      success: false,
      error: data.message || "소셜 계정 연동을 시작할 수 없습니다.",
    }
  } catch (error) {
    // ApiAuthError는 다시 throw해서 error.tsx로 전파
    if (error instanceof ApiAuthError) {
      throw error
    }
    return { success: false, error: "소셜 계정 연동 중 오류가 발생했습니다." }
  }
}

export interface UnlinkActionResult {
  success: boolean
  error?: string
}

export async function unlinkSocialAccountAction(
  provider: SocialProviderDto
): Promise<UnlinkActionResult> {
  try {
    await unlinkIdentity(provider)
    return { success: true }
  } catch (error) {
    if (error instanceof HttpApiError) {
      if (error.status === 401) {
        throw error
      }
    }

    const message =
      error instanceof HttpApiError
        ? error.message
        : "소셜 계정 연동 해제 중 오류가 발생했습니다"

    return { success: false, error: message }
  }
}
