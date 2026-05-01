"use server"

import { api } from "../api"

interface MedusaSignupParams {
  email: string
  first_name: string
  last_name: string
  almond_user_id: string
  almond_login_id: string
}

interface MedusaSignupResponse {
  success: boolean
  data?: any
  error?: string
  message?: string
}

/**
 * Medusa 회원가입 API 호출
 */
export async function medusaSignup(
  params: MedusaSignupParams
): Promise<MedusaSignupResponse> {
  const { email, first_name, last_name, almond_user_id, almond_login_id } =
    params

  try {
    const result = await api<string>(
      "medusa",
      "/auth/customer/my-auth/register",
      {
        method: "POST",
        body: {
          email,
          first_name,
          last_name: last_name,
          almond_user_id: almond_user_id,
          almond_login_id: almond_login_id,
        },
        withAuth: true,
      }
    )

    return {
      success: true,
      data: result,
    }
  } catch (error) {
    console.error("medusaSignup error:", error)
    return {
      success: false,
      error: "NETWORK_ERROR",
      message: "Failed to connect to Medusa API",
    }
  }
}
