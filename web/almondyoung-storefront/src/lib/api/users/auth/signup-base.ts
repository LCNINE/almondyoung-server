"use server"

import { SignupSchema } from "domains/auth/schemas/signup-schema"
import { api } from "../../api"

type LocalSignupRequest = Omit<
  SignupSchema,
  "passwordConfirm" | "verificationCode" | "countryCode" | "isPhoneVerified"
>

type LocalSignupSuccessResponse = {
  message: string
  userId: string
  success: true
}

type LocalSignupErrorResponse = {
  message: string
  success: false
}

type LocalSignupResponse = LocalSignupSuccessResponse | LocalSignupErrorResponse

export const createUser = async (
  _prevState: LocalSignupResponse | null,
  payload: LocalSignupRequest
): Promise<LocalSignupResponse> => {
  try {
    const result = await api<{ userId: string; message: string }>(
      "users",
      "/auth/signup",
      {
        method: "POST",
        body: payload,
        withAuth: false,
      }
    )

    return {
      message: result.message,
      userId: result.userId,
      success: true,
    }
  } catch (error: any) {
    return {
      message: error.message || "회원가입에 실패했습니다.",
      success: false,
    }
  }
}
