import { getParentAccessToken } from "../../../../lib/auth/parent-cookies"
import { authEnv } from "../../../../lib/auth/env"
import { issueMemberToken } from "../../../../lib/beautytop/member-token"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(request: Request) {
  return issueMemberToken(request, {
    getMemberId: async () => {
      const accessToken = await getParentAccessToken()
      if (!accessToken) return null
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        // Validate the existing session with its issuer. Decoding JWTs is not authentication.
        const response = await fetch(`${authEnv.userServiceUrl}/users/me`, {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        })
        if (response.status === 401 || response.status === 403) return null
        if (!response.ok) throw new Error("Login service unavailable")
        const body = await response.json()
        return body?.success === true && typeof body?.data?.id === "string" && body.data.id.length > 0
          ? body.data.id : null
      } finally {
        clearTimeout(timeout)
      }
    },
    getConfig: () => ({
      // Server environment only; never use NEXT_PUBLIC_ for this key.
      privateKey: process.env.BEAUTYTOP_SIGNING_PRIVATE_KEY ?? "",
      apiOrigin: process.env.BEAUTYTOP_API_ORIGIN ?? "",
    }),
  })
}
