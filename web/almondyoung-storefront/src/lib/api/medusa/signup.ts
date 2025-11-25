interface MedusaSignupParams {
  email: string
  first_name: string
  last_name: string
  almond_user_id: number
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
    const res = await fetch(`/api/medusa/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        first_name,
        last_name,
        almond_user_id,
        almond_login_id,
      }),
      credentials: "include",
    })

    if (!res.ok) {
      const result = await res.json()
      return {
        success: false,
        error: result.error,
        message: result.message || "Medusa signup failed",
      }
    }

    const result = await res.json()

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
