"use server"

import { api, type ApiResponse } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import { SendTwilioMessageDto, VerifyCodeDto } from "@lib/types/dto/users"

export const sendTwilioMessageApi = async (
  data: SendTwilioMessageDto
): Promise<ApiResponse<{ success: boolean }>> => {
  try {
    const result = await api<ApiResponse<{ success: boolean }>>(
      "users",
      "/twilio/send-message",
      {
        method: "POST",
        body: data,
      }
    )

    return result
  } catch (error) {
    if (error instanceof HttpApiError) {
      if (error.status === 429) {
        return { error: { message: error.message, status: error.status } }
      }
    }

    if (error instanceof ApiNetworkError) {
      return {
        error: { message: "네트워크 오류가 발생했습니다.", status: 500 },
      }
    }

    return {
      error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 },
    }
  }
}

export const verifyCodeApi = async (
  data: VerifyCodeDto
): Promise<ApiResponse<{ success: boolean }>> => {
  try {
    const result = await api<ApiResponse<{ success: boolean }>>(
      "users",
      "/twilio/verify-code",
      {
        method: "POST",
        body: data,
      }
    )

    return result
  } catch (error) {
    if (error instanceof HttpApiError) {
      return { error: { message: error.message, status: error.status } }
    }

    if (error instanceof ApiNetworkError) {
      return {
        error: { message: "네트워크 오류가 발생했습니다.", status: 500 },
      }
    }

    return {
      error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 },
    }
  }
}
