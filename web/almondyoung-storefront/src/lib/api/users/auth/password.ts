"use server"

import { api } from "../../api"

export const changePassword = async (
  currentPassword: string,
  newPassword: string
) => {
  return await api("users", "/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
    withAuth: true,
  })
}
