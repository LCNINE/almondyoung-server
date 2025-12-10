import { ApiAuthError, HttpApiError } from "@lib/api/api-error"
import { ProfileDto } from "@lib/types/dto/users"

export const updateProfile = async (
  profileData: Omit<Partial<ProfileDto>, "birthDate"> & { birthDate?: string }
) => {
  const response = await fetch(`/api/users/profile`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(profileData),
  })

  const data = await response.json()

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }
    throw new HttpApiError(
      data.error || "Failed to update profile",
      response.status,
      response.statusText,
      data
    )
  }

  return data
}
