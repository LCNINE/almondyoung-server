"use server"

import { SignupSchema } from "domains/auth/schemas/signup-schema"
import { api } from "../../api"

type LocalSignupRequest = Omit<SignupSchema, "passwordConfirm">
type LocalSignupResponse = {
  message: string
  success?: boolean
}

export const createUser = async (
  _prevState: LocalSignupResponse | null,
  payload: LocalSignupRequest & { redirectTo?: string }
): Promise<LocalSignupResponse> => {
  try {
    const { redirectTo, ...data } = payload
    const encodedRedirectTo = encodeURIComponent(redirectTo || "/")

    const result = await api<LocalSignupResponse>(
      "users",
      `/auth/signup?redirect_to=${encodedRedirectTo}`,
      { method: "POST", body: data, withAuth: false }
    )

    return { ...result, success: true }
  } catch (error: any) {
    return {
      message: error.message || "회원가입에 실패했습니다.",
      success: false,
    }
  }
}
