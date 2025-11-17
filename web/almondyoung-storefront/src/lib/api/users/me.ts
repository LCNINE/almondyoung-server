"use server"

import { UserDetail } from "domains/auth/types"
import { cache } from "react"
import { USER_SERVICE_BASE_URL } from "../api.config"
import { serverApi } from "../server-api"

export const fetchCurrentUser = cache(async (): Promise<UserDetail | null> => {
  try {
    return await serverApi(USER_SERVICE_BASE_URL + "/users/detail", {
      cache: "no-store",
    })
  } catch (error) {
    throw error
  }
})
