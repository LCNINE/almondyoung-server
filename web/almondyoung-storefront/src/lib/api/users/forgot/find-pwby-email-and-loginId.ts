"use server"

import { api } from "@lib/api/api"

export const findPwByEmailAndLoginId = async (
  email: string,
  loginId: string
) => {
  return api<{ success: boolean }>("users", "/auth/forget/password", {
    method: "POST",
    body: { email, loginId },
    withAuth: false,
  })
}
