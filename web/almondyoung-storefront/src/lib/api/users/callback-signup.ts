import "server-only"
import { serverApi } from "../server-api"
import { USER_SERVICE_BASE_URL } from "../api.config"

export const callbackSignup = async (userId: string) => {
  return await serverApi(`${USER_SERVICE_BASE_URL}/auth/callback/signup`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  })
}

export const callbackSocialSignup = async (userId: string) => {
  return await serverApi(`${USER_SERVICE_BASE_URL}/auth/kakao/callback`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  })
}
