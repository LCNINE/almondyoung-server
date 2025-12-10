import { ApiAuthError, HttpApiError } from "@lib/api/api-error"
import { UserVerificationStatusDto } from "@lib/types/dto/users"
import { getCookies } from "@lib/data/cookies"

export const getVerificationStatus =
  async (): Promise<UserVerificationStatusDto> => {
    const cookies = await getCookies()

    const response = await fetch(
      `${process.env.APP_URL}/api/users/verification-status`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookies,
        },
      }
    )

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
        data.message || "Failed to get verification status",
        response.status,
        response.statusText,
        data
      )
    }

    return data
  }
