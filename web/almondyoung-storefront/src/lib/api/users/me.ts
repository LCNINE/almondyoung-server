"use server"

import type { UserDetail } from "@lib/types/ui/user"
import { cache } from "react"
import { api } from "../api"

export const fetchMe = cache(async (): Promise<UserDetail> => {
  const result = await api<UserDetail>("users", "/users/detail", {
    cache: "no-store",
    withAuth: true,
  })

  return result
})
