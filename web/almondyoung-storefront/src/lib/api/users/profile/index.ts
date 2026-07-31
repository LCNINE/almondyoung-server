"use server"

import { cache } from "react"
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
 *
 * 한 번의 렌더 안에서 user-service 왕복은 한 번만 나가게 메모이제이션한다.
 * 루트 레이아웃과 (main) 레이아웃이 각각 부르고 홈은 페이지에서 한 번 더 불러
 * 페이지 하나 그리는 데 같은 조회가 2~3회 반복되고 있었다 (`cache: "no-store"`
 * 라 Next 의 fetch 중복 제거도 걸리지 않는다).
 *
 * 수명은 요청 하나의 렌더 패스이며 요청 간에는 공유되지 않는다.
 */
const getMyProfileOnce = cache(async (): Promise<UserDetailDto> => {
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
})

// "use server" 파일은 async 함수만 export 할 수 있어 cache() 결과를 직접 내보내지 못한다.
export const getMyProfile = async (): Promise<UserDetailDto> => getMyProfileOnce()

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
