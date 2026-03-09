"use server"

import { cache } from "react"
import {
  removeAccessToken,
  removeMedusaAuthToken,
  removeRefreshToken,
} from "@lib/data/cookies"
import type { UserDetail } from "@lib/types/ui/user"
import { api } from "../api"
import { HttpApiError } from "../api-error"

const fetchMeInternal = async (): Promise<UserDetail> => {
  try {
    const result = await api<UserDetail>("users", "/users/me", {
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

    throw error
  }
}

export const fetchMe = cache(fetchMeInternal)
