import { getServiceClient } from "./client"

export interface SigninBody {
  loginId: string
  password: string
  rememberMe?: boolean
}

export interface MeResponse {
  id: string
  email: string
  loginId: string
  username?: string
  nickname?: string
  roles?: string[]
}

function userClient() {
  return getServiceClient("user")
}

export const authApi = {
  async signin(body: SigninBody): Promise<void> {
    await userClient().post("/auth/signin", body)
  },

  async signout(): Promise<void> {
    await userClient().post("/auth/signout")
  },

  async fetchMe(): Promise<MeResponse> {
    const res = await userClient().get<MeResponse>("/users/me")
    return res.data
  },
}
