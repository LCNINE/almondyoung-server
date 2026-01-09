"use server"

import { appConfig } from "@/lib/config/medusa"
import { getCacheTag, setTokenCookies } from "@lib/data/cookies"
import { revalidatePath, revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import { api } from "../api"
import { ApiNetworkError, HttpApiError } from "../api-error"
import { transferCart } from "../medusa/customer"
import { medusaSignin } from "../medusa/signin"

// 반환 타입 정의
type LoginResult =
  | { success: true; accessToken: string; refreshToken: string }
  | { success: false; error: string; code?: string }

export async function login(
  prevState: LoginResult | null,
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

    if (error instanceof HttpApiError) {
      if (error.status === 400 || error.status === 401) {
        return {
          success: false,
          error: "아이디 또는 비밀번호가 일치하지 않습니다",
          code: "INVALID_CREDENTIALS",
        }
      }
      if (error.status === 429) {
        return {
          success: false,
          error: "너무 많은 시도가 있었습니다. 잠시 후 다시 시도해주세요",
          code: "TOO_MANY_ATTEMPTS",
        }
      }
      return {
        success: false,
        error: error.message || "로그인 중 오류가 발생했습니다",
      }
    }

    if (error instanceof ApiNetworkError) {
      return {
        success: false,
        error: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요",
        code: "NETWORK_ERROR",
      }
    }

    return {
      success: false,
      error: "로그인 처리 중 오류가 발생했습니다",
    }
  }

  // 로그인 성공 후 처리
  await medusaSignin()

  const customerCacheTag = await getCacheTag("customers")
  revalidateTag(customerCacheTag)

  try {
    await transferCart()
  } catch (error) {
    console.error("Cart transfer error:", error)
  }

  const targetPath = redirectTo ?? `${appConfig.auth.redirect_to}`
  revalidatePath("/", "layout")
  revalidatePath(targetPath)
  redirect(targetPath)
}
