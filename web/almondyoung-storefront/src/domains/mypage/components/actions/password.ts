"use server"

import { api } from "@lib/api/api"
import { HttpApiError } from "@lib/api/api-error"
import { signout } from "@lib/api/users/signout"
import { redirect } from "next/navigation"

export type PasswordActionState = {
  success: boolean
  error?: string
  field?: "currentPassword" | "newPassword" | "newPasswordConfirm"
} | null

export async function changePasswordAction(
  _prevState: PasswordActionState,
  formData: FormData
): Promise<PasswordActionState> {
  const currentPassword = formData.get("currentPassword") as string
  const newPassword = formData.get("newPassword") as string
  const newPasswordConfirm = formData.get("newPasswordConfirm") as string

  if (!currentPassword || currentPassword.length < 8) {
    return {
      success: false,
      error: "현재 비밀번호는 8자 이상이어야 합니다",
      field: "currentPassword",
    }
  }

  if (!newPassword || newPassword.length < 8 || newPassword.length > 20) {
    return {
      success: false,
      error: "새 비밀번호는 8~20자여야 합니다",
      field: "newPassword",
    }
  }

  if (newPassword !== newPasswordConfirm) {
    return {
      success: false,
      error: "비밀번호가 일치하지 않습니다",
      field: "newPasswordConfirm",
    }
  }

  try {
    await api("users", "/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
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
        : "비밀번호 변경 중 오류가 발생했습니다"

    return {
      success: false,
      error: message,
      field: message.includes("새 비밀번호는")
        ? "newPassword"
        : "currentPassword",
    }
  }

  await signout()

  redirect("/kr/login")
}
