"use server"

import { ApiAuthError } from "@lib/api/api-error"
import { getCookies } from "@lib/data/cookies"
import { BusinessInfoResponseDto } from "@lib/types/dto/users"

export const getMyBusiness =
  async (): Promise<BusinessInfoResponseDto | null> => {
    const cookies = await getCookies()

    const response = await fetch(
      `${process.env.APP_URL}/api/users/business/me`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookies,
        },

        next: {
          tags: ["businesses-info"],
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

      throw new Error(data.message || "Failed to get business")
    }

    return data
  }
