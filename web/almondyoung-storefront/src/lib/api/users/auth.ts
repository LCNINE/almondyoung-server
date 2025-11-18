import { clientApi } from "@lib/api/client-api"
import { SignupSchema } from "domains/auth/schemas/signup-schema"
import { USER_SERVICE_BASE_URL } from "../api.config"

type LocalSignupRequest = Omit<SignupSchema, "passwordConfirm" | "marketingAll">
type LocalSignupResponse = {
  message: string
}

export const createUser = async (
  data: LocalSignupRequest,
  redirectTo?: string
): Promise<LocalSignupResponse> => {
  const encodedRedirectTo = encodeURIComponent(redirectTo || "/")

  return clientApi(
    USER_SERVICE_BASE_URL + "/auth/signup?redirect_to=" + encodedRedirectTo,
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  )
}

export const findIdByEmail = async (email: string) => {
  return clientApi(USER_SERVICE_BASE_URL + "/auth/forget-userid", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export const findPwByEmailAndLoginId = async (
  email: string,
  loginId: string
) => {
  return clientApi(USER_SERVICE_BASE_URL + "/auth/forget-password", {
    method: "POST",
    body: JSON.stringify({ email, loginId }),
  })
}
