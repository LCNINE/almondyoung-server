"use server"

import { setMedusaAuthToken } from "@lib/data/cookies"
import { api } from "../api"

// Customer 로그인은 OIDC redirect 플로우(`lib/api/medusa/sso.ts`)로 일원화되었다.
// 본 파일은 admin actor 전용 토큰 발급(my-auth)만 유지한다.
export async function medusaSigninAdmin(): Promise<{
  success: boolean
  data?: string
  error?: string
  message?: string
}> {
  try {
    const data = await api<{ token: string }>("medusa", "/auth/user/my-auth", {
      method: "POST",
      withAuth: true,
    })

    await setMedusaAuthToken(data.token)

    return {
      success: true,
      data: data.token,
    }
  } catch (error) {
    console.error("medusaSigninAdmin error:", error)
    return {
      success: false,
      error: "NETWORK_ERROR",
      message: "Failed to connect to Medusa API",
    }
  }
}
