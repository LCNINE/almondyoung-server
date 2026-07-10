"use server"

import { api, type ApiResponse } from "@lib/api/api"
import { ApiAuthError, ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import type { SendEmailCodeDto, VerifyEmailCodeDto } from "@lib/types/dto/users"

// 인증 필요(withAuth 기본 true). 401 은 error.tsx 토큰 복구로 넘기기 위해 re-throw.
export const sendEmailCodeApi = async (
  data: SendEmailCodeDto
): Promise<ApiResponse<{ success: boolean }>> => {
  try {
    await api<{ message: string }>("users", "/email-verification/send-code", {
      method: "POST",
      body: data,
    })
    return { data: { success: true } }
  } catch (error) {
    if (error instanceof ApiAuthError) throw error
    if (error instanceof HttpApiError) {
      return { error: { message: error.message, status: error.status } }
    }
    if (error instanceof ApiNetworkError) {
      return { error: { message: "네트워크 오류가 발생했습니다.", status: 500 } }
    }
    return { error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 } }
  }
}

export const verifyEmailCodeApi = async (
  data: VerifyEmailCodeDto
): Promise<ApiResponse<{ success: boolean }>> => {
  try {
    await api<{ message: string }>("users", "/email-verification/verify-code", {
      method: "POST",
      body: data,
    })
    return { data: { success: true } }
  } catch (error) {
    if (error instanceof ApiAuthError) throw error
    if (error instanceof HttpApiError) {
      return { error: { message: error.message, status: error.status } }
    }
    if (error instanceof ApiNetworkError) {
      return { error: { message: "네트워크 오류가 발생했습니다.", status: 500 } }
    }
    return { error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 } }
  }
}
