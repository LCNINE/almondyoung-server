import { clientApi } from "@lib/client-api"
// import { SignupSchema } from "@modules/auth/schemas/signup-schema"

// 임시 타입 정의
type SignupSchema = {
  email: string
  password: string
  passwordConfirm: string
  marketingAll: boolean
}

type LocalSignupRequest = Omit<SignupSchema, "passwordConfirm" | "marketingAll">
type LocalSignupResponse = {
  message: string
}

export const createUser = async (
  data: LocalSignupRequest
): Promise<LocalSignupResponse> => {
  return clientApi("/auth/signup", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export const findIdByEmail = async (email: string) => {
  return clientApi("/auth/forget-userid", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export const findPwByEmailAndLoginId = async (
  email: string,
  loginId: string
) => {
  return clientApi("/auth/forget-password", {
    method: "POST",
    body: JSON.stringify({ email, loginId }),
  })
}
