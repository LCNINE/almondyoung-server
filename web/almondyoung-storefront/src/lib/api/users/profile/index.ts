"use server"

import { api } from "@lib/api/api"
import { ProfileDto, UserDetailDto } from "@lib/types/dto/users"
import { HttpApiError } from "../../api-error"
// eslint-disable-next-line no-restricted-imports
import {
  removeAccessToken,
  removeMedusaAuthToken,
  removeRefreshToken,
} from "@/lib/data/cookies"

/**
 * 현재 사용자 프로필 상세 조회 (전화번호, 주소, 상점 정보 포함)
 */
export const getMyProfile = async (): Promise<UserDetailDto> => {
  try {
    const data = await api<UserDetailDto>("users", "/users/me/profile", {
      method: "GET",
      cache: "no-store",
      withAuth: true,
    })

    return data
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
      return null as unknown as UserDetailDto
    }

    throw error
  }
}

export const updateProfile = async (
  profileData: Omit<Partial<ProfileDto>, "birthDate"> & { birthDate?: string }
) => {
  const data = await api<ProfileDto>("users", "/users/me", {
    method: "PATCH",
    body: profileData,
    withAuth: true,
  })

  return data
}
