"use server"

import { api, type ApiResponse } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"

export const findIdByPhoneNumber = async (
  phoneNumber: string
): Promise<ApiResponse<{ loginIds: string[] }>> => {
  try {
    const result = await api<{ loginIds: string[] }>(
      "users",
      "/auth/forget-userid",
      {
        method: "POST",
        body: { phoneNumber },
        withAuth: false,
      }
    )

    return { data: result }
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
