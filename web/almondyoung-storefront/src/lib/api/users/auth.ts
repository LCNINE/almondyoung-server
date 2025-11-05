import { clientApi } from "@lib/client-api"
import { SignupSchema } from "domains/auth/schemas/signup-schema"
import { USER_API_CONFIG, USER_API_ENDPOINTS } from "@lib/api/users/config"

type LocalSignupRequest = Omit<SignupSchema, "passwordConfirm" | "marketingAll">
type LocalSignupResponse = {
  message: string
}

export const createUser = async (
  data: LocalSignupRequest
): Promise<LocalSignupResponse> => {
  return clientApi(USER_API_CONFIG.BASE_URL + "/auth/signup", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export const findIdByEmail = async (email: string) => {
  return clientApi(USER_API_CONFIG.BASE_URL + "/auth/forget-userid", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export const findPwByEmailAndLoginId = async (
  email: string,
  loginId: string
) => {
  return clientApi(USER_API_CONFIG.BASE_URL + "/auth/forget-password", {
    method: "POST",
    body: JSON.stringify({ email, loginId }),
  })
}
