"use client"

import { SignupSchema } from "domains/auth/schemas/signup-schema"
import { ApiError } from "../api-error"

type LocalSignupRequest = Omit<SignupSchema, "passwordConfirm" | "marketingAll">
type LocalSignupResponse = {
  success: boolean
  data: {
    message: string
  }
}

export const createUser = async (
  data: LocalSignupRequest,
  redirectTo?: string
): Promise<LocalSignupResponse> => {
  const encodedRedirectTo = encodeURIComponent(redirectTo || "/")

  const response = await fetch(
    "/api/auth/signup?redirect_to=" + encodedRedirectTo,
    {
      method: "POST",
      body: JSON.stringify(data),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    }
  )

  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new ApiError(
      result.error || "회원가입에 실패했습니다.",
      response.status,
      response.statusText,
      result
    )
  }

  return result
}

export const findIdByEmail = async (email: string) => {
  const response = await fetch("/api/auth/forget/userid", {
    method: "POST",
    body: JSON.stringify({ email }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  })

  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new ApiError(
      result.error || "아이디 찾기에 실패했습니다.",
      response.status,
      response.statusText,
      result
    )
  }
  return result
}

export const findPwByEmailAndLoginId = async (
  email: string,
  loginId: string
) => {
  const response = await fetch("/api/auth/forget/password", {
    method: "POST",
    body: JSON.stringify({ email, loginId }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  })

  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new ApiError(
      result.error || "비밀번호 찾기에 실패했습니다.",
      response.status,
      response.statusText,
      result
    )
  }

  return result
}
