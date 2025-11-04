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
  return clientApi(USER_API_CONFIG.BASE_URL + USER_API_ENDPOINTS.SIGNUP, {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export const findIdByEmail = async (email: string) => {
  return clientApi(
    USER_API_CONFIG.BASE_URL + USER_API_ENDPOINTS.FIND_ID_BY_EMAIL,
    {
      method: "POST",
      body: JSON.stringify({ email }),
    }
  )
}

export const findPwByEmailAndLoginId = async (
  email: string,
  loginId: string
) => {
  return clientApi(
    USER_API_CONFIG.BASE_URL + USER_API_ENDPOINTS.FIND_PW_BY_EMAIL_AND_LOGIN_ID,
    {
      method: "POST",
      body: JSON.stringify({ email, loginId }),
    }
  )
}
