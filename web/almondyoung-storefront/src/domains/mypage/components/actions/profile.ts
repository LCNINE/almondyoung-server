"use server"

import { sdk } from "@/lib/config/medusa"
import { formatBirthday } from "@/lib/utils/format-birthday"
import { getCacheTag, removeAllAuthTokens } from "@lib/data/cookies"
import { api } from "@lib/api/api"
import { HttpApiError } from "@lib/api/api-error"
import { revalidatePath, revalidateTag } from "next/cache"
import { headers } from "next/headers"

export type ProfileActionState = {
  success: boolean
  error?: string
  field?: "username" | "nickname" | "birthday"
} | null

export async function updateProfileAction(
  _prevState: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const username = formData.get("username") as string
  const nickname = formData.get("nickname") as string
  const birthday = formData.get("birthday") as string

  const formattedBirthday = formatBirthday(birthday)

  if (!username) {
    return { success: false, error: "이름을 입력해주세요", field: "username" }
  }

  if (!nickname) {
    return {
      success: false,
      error: "닉네임을 입력해주세요",
      field: "nickname",
    }
  }

  try {
    await api("users", "/users/me", {
      method: "PATCH",
      body: {
        username,
        nickname,
        ...(formattedBirthday ? { birthDate: formattedBirthday } : {}),
      },
      withAuth: true,
    })
  } catch (error) {
    if (error instanceof HttpApiError) {
      if (error.status === 401) {
        throw error
      }
    }
    const message =
      error instanceof HttpApiError
        ? error.message
        : "회원정보 수정 중 오류가 발생했습니다"

    return { success: false, error: message }
  }

  revalidatePath("/mypage")

  return { success: true }
}

export async function updatePhoneNumberAction(
  phoneNumber: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await api("users", "/users/me", {
      method: "PATCH",
      body: {
        phoneNumber,
      },
      withAuth: true,
    })

    revalidatePath("/mypage")
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
        : "휴대폰 번호 변경 중 오류가 발생했습니다"

    return { success: false, error: message }
  }
}

/**
 * 이메일 인증 링크 발송. 메일 링크 클릭 → user-service verify-email → auth-web
 * /callback/signup 안내 페이지 → redirect_to 로 복귀. auth-web sanitizeRedirectTo 가
 * "허용 호스트의 절대 URL"만 통과시키므로 반드시 절대 URL 로 넘긴다.
 */
export async function resendVerificationEmailAction(
  email: string
): Promise<{ success: boolean; error?: string }> {
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? ""
  const proto = h.get("x-forwarded-proto") ?? "http"
  const redirectTo = `${proto}://${host}/mypage/account/profile?emailVerified=true`

  try {
    await api("users", "/auth/resend-verification-email", {
      method: "POST",
      body: { email },
      params: { redirect_to: redirectTo },
      withAuth: false,
    })
    return { success: true }
  } catch (error) {
    const message = error instanceof HttpApiError ? error.message : undefined
    return { success: false, error: message }
  }
}

export async function withdrawUserAction(): Promise<void> {
  try {
    await api("users", "/auth", {
      method: "DELETE",
      withAuth: true,
    })
  } catch (error) {
    if (
      error instanceof HttpApiError &&
      (error.status === 404 || error.status === 405)
    ) {
      await api("users", "/users/me", {
        method: "DELETE",
        withAuth: true,
      })
    } else {
      throw error
    }
  }

  sdk.auth.logout().catch(() => {})
  await api("users", "/auth/signout", {
    method: "POST",
    withAuth: false,
  }).catch(() => {})

  const [customerCacheTag, cartCacheTag] = await Promise.all([
    getCacheTag("customers"),
    getCacheTag("carts"),
  ])

  await removeAllAuthTokens()
  revalidateTag(customerCacheTag)
  revalidateTag(cartCacheTag)
  revalidatePath("/mypage")
}
