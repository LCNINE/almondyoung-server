"use server"

import { api } from "@lib/api/api"

export const findIdByEmail = async (email: string) => {
  return api<{ success: boolean }>("users", "/auth/forget/userid", {
    method: "POST",
    body: { email },
    withAuth: false,
  })
}
