"use server"

import { formatBirthday } from "@/lib/utils/format-birthday"
import { api } from "@lib/api/api"
import { HttpApiError } from "@lib/api/api-error"
import { revalidatePath } from "next/cache"

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
        phoneNumber: phoneNumber.replace(/\D/g, ""),
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
