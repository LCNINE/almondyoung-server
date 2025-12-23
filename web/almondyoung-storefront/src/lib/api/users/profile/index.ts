"use server"

import { api } from "@lib/api/api"
import { ProfileDto } from "@lib/types/dto/users"

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
