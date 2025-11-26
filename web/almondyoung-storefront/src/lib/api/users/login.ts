"use server"

import { ApiError } from "@lib/api/api-error"
import { appConfig } from "@lib/app-config"
import { getCacheTag, setTokenCookies } from "@lib/data/cookies"
import { transferCart } from "@lib/api/medusa/customer"
import { revalidatePath, revalidateTag } from "next/cache"
import { medusaSignin } from "../medusa/signin"

type LoginState =
  | { success: true; redirectTo: string }
  | { success: false; error: string; code?: string }

export async function login(
  _currentState: LoginState | null,
  formData: FormData
): Promise<LoginState> {
  const loginId = formData.get("loginId") as string
  const password = formData.get("password") as string
  const countryCode = formData.get("countryCode") as string
  const redirectTo = formData.get("redirect_to") as string

  try {
    //  사용자 서비스 로그인
    const result = await fetch(`${process.env.BACKEND_URL}/users/auth/signin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ loginId, password }),
    })
    const resultData = await result.json()

    if (!result.ok) {
      throw new ApiError(
        resultData.message || "로그인에 실패했습니다",
        result.status,
        resultData
      )
    }

    console.log("[LOGIN] User service login success", {
      hasAccessToken: !!resultData.data?.accessToken,
      hasRefreshToken: !!resultData.data?.refreshToken,
    })

    // 응답에서 토큰을 받아서 쿠키로 설정
    // (Server Action에서는 백엔드의 Set-Cookie가 브라우저로 자동 전달되지 않으므로)
    await setTokenCookies(
      resultData.data.accessToken,
      resultData.data.refreshToken
    )

    console.log("[LOGIN] Cookies set successfully")
  } catch (error: any) {
    console.error("User service login error:", error)

    if (error instanceof ApiError) {
      if (error.status === 400) {
        return {
          success: false,
          error: "아이디 또는 비밀번호를 확인해주세요",
          code: "INVALID_CREDENTIALS",
        }
      }
      if (error.status === 401) {
        return {
          success: false,
          error: "아이디 또는 비밀번호가 일치하지 않습니다",
          code: "UNAUTHORIZED",
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

    // 네트워크 관련 에러 처리
    if (
      error instanceof Error &&
      (error.message.includes("fetch") ||
        error.message.includes("network") ||
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("ETIMEDOUT") ||
        error.name === "FetchError" ||
        error.name === "NetworkError")
    ) {
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

  await medusaSignin()

  const customerCacheTag = await getCacheTag("customers")
  revalidateTag(customerCacheTag)

  try {
    await transferCart()
  } catch (error) {
    console.error("Cart transfer error:", error)
    // 장바구니 이전 실패는 치명적이지 않으므로 로그인은 성공으로 처리
    console.warn("장바구니 이전 실패, 하지만 로그인은 성공")
  }

  // redirectTo 처리: 기본값은 홈
  const targetPath = redirectTo ?? `${appConfig.auth.redirect_to}`

  // 캐시 무효화: layout과 해당 페이지가 다시 렌더링되도록
  revalidatePath("/", "layout")
  revalidatePath(targetPath)

  // redirect 대신 성공 상태와 리다이렉트 경로 반환
  return {
    success: true,
    redirectTo: targetPath,
  }
}
