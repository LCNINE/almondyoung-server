"use server"

import { User } from "domains/auth/types"
import { cache } from "react"
import { USER_SERVICE_BASE_URL } from "../api.config"
import { serverApi } from "../server-api"

export const fetchUserByUserId = cache(
  async (userId: string): Promise<User | null> => {
    try {
      return await serverApi(`${USER_SERVICE_BASE_URL}/users/${userId}`, {
        cache: "no-store",
      })
    } catch (error) {
      throw error
    }
  }
)
