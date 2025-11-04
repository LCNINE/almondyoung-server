"use server"

import { USER_API_CONFIG, USER_API_ENDPOINTS } from "@lib/api/users/config"
import { serverApi } from "@lib/server-api"
import { UserDetail } from "domains/auth/types"
import { cookies, headers } from "next/headers"
import { cache } from "react"

// todo: 네트워크 에러 처리하고 클라이언트 토스트 컴포넌트에 보내는거 추가
export const fetchCurrentUser = cache(async (): Promise<UserDetail | null> => {
  const cookieStore = await cookies()
  const headersList = await headers()
  const pathname = headersList.get("x-pathname") || ""
  const countryCode = pathname.split("/")[1] || "kr"

  try {
    return await serverApi(
      USER_API_CONFIG.BASE_URL + USER_API_ENDPOINTS.USER_DETAILS,
      {
        cache: "no-store",
      }
    )
  } catch (error) {
    throw error
  }
})
