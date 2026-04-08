"use server"

import { cache } from "react"
import {
  removeAccessToken,
  removeMedusaAuthToken,
  removeRefreshToken,
} from "@lib/data/cookies"
import { api } from "../api"
import { HttpApiError } from "../api-error"
import type { UserBaseType } from "@/lib/types/common/users"

const fetchMeInternal = async (): Promise<UserBaseType> => {
  try {
    const result = await api<UserBaseType>("users", "/users/me", {
      cache: "no-store",
      withAuth: true,
    })

    return result
  } catch (error) {
    // 사용자가 누락되었거나(삭제되었거나/유효하지 않은 경우) 인증되지 않은 것으로 간주하고 토큰을 삭제합니다.
    if (error instanceof HttpApiError && error.status === 404) {
      await Promise.all([
        removeAccessToken().catch(() => {}),
        removeRefreshToken().catch(() => {}),
        removeMedusaAuthToken().catch(() => {}),
      ])
    }

    if (error instanceof HttpApiError && error.status === 503) {
      // 서버 일시 장애 - 비로그인처럼 처리하되 토큰은 유지
      console.warn("Users service temporarily unavailable (503)")
      return null as unknown as UserBaseType
    }

    throw error
  }
}

export const fetchMe = cache(fetchMeInternal)
