"use server"

import { ApiError } from "@lib/api-error"
import { serverApi } from "@lib/server-api"
import { setTokenCookies } from "../../data/cookies"
import { redirect } from "next/navigation"
import { appConfig } from "@lib/app-config"

type LoginState =
  | { success: true }
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
    // 2. 사용자 서비스 로그인
    const result = await serverApi("/auth/signin", {
      method: "POST",
      body: JSON.stringify({ loginId, password }),
    })

    // 응답에서 토큰을 받아서 쿠키로 설정
    // (Server Action에서는 백엔드의 Set-Cookie가 브라우저로 자동 전달되지 않으므로)
    await setTokenCookies(result.accessToken, result.refreshToken)
  } catch (error: any) {
    console.error("User service login error:", error)

    if (error instanceof ApiError) {
      // 상태 코드별 에러 메시지
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

  redirect(
    `/${countryCode}/${redirectTo}` ||
      `/${countryCode}/${appConfig.auth.redirect_to}`
  )

  // try {
  //   // 3. Medusa 인증 토큰 생성
  //   const headers = await getAuthHeaders("accessToken")

  //   const res = await fetch(
  //     `${process.env.MEDUSA_BACKEND_URL}/auth/customer/my-auth`,
  //     {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //         ...headers,
  //       },
  //     }
  //   )

  //   const result = await res.json()

  //   if (!res.ok) {
  //     console.error("Medusa auth error:", result)

  //     // Medusa 에러 처리
  //     if (res.status === 404) {
  //       return {
  //         success: false,
  //         error:
  //           "사용자 정보를 찾을 수 없습니다. 고객 계정을 먼저 생성해주세요",
  //         code: "CUSTOMER_NOT_FOUND",
  //       }
  //     }

  //     if (result.type === "unauthorized") {
  //       return {
  //         success: false,
  //         error: "해당 사용자 정보가 존재하지 않습니다.",
  //         code: "MEDUSA_AUTH_ERROR",
  //       }
  //     }

  //     return {
  //       success: false,
  //       error: result.error || "인증 처리 중 오류가 발생했습니다",
  //       code: "MEDUSA_AUTH_ERROR",
  //     }
  //   }

  //   // 4. 토큰 저장 및 캐시 무효화
  //   await setAuthToken(result.token as string)
  //   const customerCacheTag = await getCacheTag("customers")
  //   revalidateTag(customerCacheTag)
  // } catch (error) {
  //   console.error("Medusa auth process error:", error)
  //   return {
  //     success: false,
  //     error: "인증 토큰 처리 중 오류가 발생했습니다",
  //     code: "TOKEN_PROCESS_ERROR",
  //   }
  // }

  // try {
  //   // 5. 장바구니 이전
  //   await transferCart()
  //   return { success: true }
  // } catch (error) {
  //   console.error("Cart transfer error:", error)
  //   // 장바구니 이전 실패는 치명적이지 않으므로 로그인은 성공으로 처리
  //   console.warn("장바구니 이전 실패, 하지만 로그인은 성공")
  //   return { success: true }
  // }
}
