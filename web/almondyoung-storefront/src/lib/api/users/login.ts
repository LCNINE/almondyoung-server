"use server"

import { siteConfig } from "@/lib/config/site"
import { normalizeRedirectPath, toLocalizedPath } from "@/lib/utils/locale-path"
import { getCacheTag, setTokenCookies } from "@lib/data/cookies"
import { revalidatePath, revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import { api } from "../api"
import type { HttpApiError } from "../api-error"
import { medusaSignin } from "../medusa/signin"

// 반환 타입 정의
type LoginResult =
  | { success: true; accessToken: string; refreshToken: string }
  | { success: false; error: string; code?: string }

export async function login(
  _: LoginResult | null,
  formData: FormData
): Promise<LoginResult> {
  const loginId = formData.get("loginId") as string
  const password = formData.get("password") as string
  const countryCode = formData.get("countryCode") as string
  const redirectTo = formData.get("redirect_to") as string

  let tokens: { accessToken: string; refreshToken: string }

  try {
    tokens = await api<{ accessToken: string; refreshToken: string }>(
      "users",
      "/auth/signin",
      {
        method: "POST",
        body: { loginId, password },
        withAuth: false, // 로그인은 인증 필요 없음
      }
    )

    await setTokenCookies(tokens.accessToken, tokens.refreshToken)
  } catch (error) {
    console.error("User service login error:`", error)

    if (error instanceof Error) {
      if (error.name === "ApiNetworkError") {
        return {
          success: false,
          error: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요",
          code: "NETWORK_ERROR",
        }
      }

      const httpError = error as HttpApiError
      if (httpError.status === 400 || httpError.status === 401) {
        return {
          success: false,
          error: "아이디 또는 비밀번호가 일치하지 않습니다",
          code: "INVALID_CREDENTIALS",
        }
      }
      if (httpError.status === 429) {
        return {
          success: false,
          error: "너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요",
          code: "TOO_MANY_ATTEMPTS",
        }
      }
      if (httpError.status) {
        return {
          success: false,
          error: error.message || "로그인 중 오류가 발생했습니다",
        }
      }
    }

    return {
      success: false,
      error: "로그인 처리 중 오류가 발생했습니다",
    }
  }

  // 로그인 성공 후 Medusa 인증/카트 연결까지 성공해야 진행
  const medusaSigninResult = await medusaSignin()
  if (!medusaSigninResult.success) {
    return {
      success: false,
      error: "메두사 인증 토큰 처리 중 오류가 발생했습니다",
      code: "TOKEN_PROCESS_ERROR",
    }
  }

  const customerCacheTag = await getCacheTag("customers")
  revalidateTag(customerCacheTag)

  const rawTargetPath = redirectTo?.startsWith("/")
    ? redirectTo
    : redirectTo
      ? `/${redirectTo}`
      : siteConfig.auth.redirect_to
  const targetPath = normalizeRedirectPath(rawTargetPath)
  const localizedTargetPath = toLocalizedPath(countryCode, targetPath)

  revalidatePath("/", "layout")
  revalidatePath(localizedTargetPath)
  redirect(localizedTargetPath)
}
