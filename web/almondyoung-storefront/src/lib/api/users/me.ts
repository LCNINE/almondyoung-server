"use server"

import { USER_API_CONFIG } from "@lib/api/users/config"
import { serverApi } from "@lib/server-api"
import { UserDetail } from "domains/auth/types"
import { cookies, headers } from "next/headers"
import { cache } from "react"

export const fetchCurrentUser = cache(async (): Promise<UserDetail | null> => {
  const cookieStore = await cookies()
  const headersList = await headers()
  const pathname = headersList.get("x-pathname") || ""
  const countryCode = pathname.split("/")[1] || "kr"

  try {
    return await serverApi(USER_API_CONFIG.BASE_URL + "/users/detail", {
      cache: "no-store",
    })
  } catch (error) {
    throw error
  }
})
