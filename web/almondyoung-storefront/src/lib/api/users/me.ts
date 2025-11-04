"use server"

import { ApiError } from "@lib/api-error"
import { serverApi } from "@lib/server-api"
import { UserDetailsResponseDto } from "@lib/types/dto/user"
import { UserBasicInfo as User } from "@lib/types/ui/user"
import { toUserBasicInfo } from "@lib/utils/transformers/user.transformer"
import { cookies, headers } from "next/headers"

export const fetchCurrentUser = async (): Promise<User | null> => {
  const cookieStore = await cookies()
  const headersList = await headers()
  const pathname = headersList.get("x-pathname") || ""
  const countryCode = pathname.split("/")[1] || "kr"

  try {
    const dto: UserDetailsResponseDto = await serverApi("/users/detail")
    return toUserBasicInfo(dto)
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.message === "Network Error") {
        throw new Error("Network Error")
      }

      if (error.message === "UNAUTHORIZED") {
        // 메인페이지일경우 401에러가 발생해도 무시하고 null반환
        if (pathname === `/${countryCode}/` || pathname === `/${countryCode}`) {
          return null
        }
      }
    }

    throw error
  }
}
