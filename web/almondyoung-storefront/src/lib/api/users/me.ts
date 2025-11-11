"use server"

import { UserDetail } from "domains/auth/types"
import { cookies, headers } from "next/headers"
import { cache } from "react"
import { serverApi } from "../server-api"
import { USER_SERVICE_BASE_URL } from "../api.config"

export const fetchCurrentUser = cache(async (): Promise<UserDetail | null> => {
  const cookieStore = await cookies()
  const headersList = await headers()
  const pathname = headersList.get("x-pathname") || ""
  const countryCode = pathname.split("/")[1] || "kr"

  try {
    return await serverApi(USER_SERVICE_BASE_URL + "/users/detail", {
      cache: "no-store",
    })
  } catch (error) {
    throw error
  }
})
