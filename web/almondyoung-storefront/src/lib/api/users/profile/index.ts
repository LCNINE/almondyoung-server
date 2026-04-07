"use server"

import { api } from "@lib/api/api"
import { ProfileDto, UserDetailDto } from "@lib/types/dto/users"

/**
 * 현재 사용자 프로필 상세 조회 (전화번호, 주소, 상점 정보 포함)
 */
export const getMyProfile = async (): Promise<UserDetailDto> => {
  const data = await api<UserDetailDto>("users", "/users/me/profile", {
    method: "GET",
    cache: "no-store",
    withAuth: true,
  })

  return data
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
