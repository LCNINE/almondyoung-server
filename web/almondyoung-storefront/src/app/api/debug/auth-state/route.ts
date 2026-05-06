import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { getMyProfile } from "@/lib/api/users/profile"
import { requireBackendBaseUrl } from "@/lib/config/backend"

export const dynamic = "force-dynamic"
export const revalidate = 0

function decodeJwtPayload(token?: string) {
  if (!token) return null

  try {
    const payload = token.split(".")[1]
    if (!payload) return null

    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Record<string, unknown>

    return {
      iss: decoded.iss ?? null,
      aud: decoded.aud ?? null,
      sub: decoded.sub ?? null,
      email: decoded.email ?? null,
      login_id: decoded.login_id ?? null,
      client_id: decoded.client_id ?? null,
      scope: decoded.scope ?? null,
      exp: decoded.exp ?? null,
    }
  } catch {
    return null
  }
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 })
  }

  const cookieStore = await cookies()
  const accessToken = cookieStore.get("accessToken")?.value
  const cookieState = {
    medusaJwt: !!cookieStore.get("_medusa_jwt")?.value,
    accessToken: !!accessToken,
    refreshToken: !!cookieStore.get("refreshToken")?.value,
  }
  const accessTokenPayload = decodeJwtPayload(accessToken)
  const userServiceBaseUrl = requireBackendBaseUrl("users")

  const fetchWithBearer = async (path: string) => {
    if (!accessToken) {
      return { status: null, body: "missing accessToken" }
    }

    try {
      const response = await fetch(`${userServiceBaseUrl}${path}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
      })
      return {
        status: response.status,
        body: await response.text(),
      }
    } catch (error) {
      return {
        status: null,
        body: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const [rawUserinfo, rawProfile] = await Promise.all([
    fetchWithBearer("/oauth/userinfo"),
    fetchWithBearer("/users/me/profile"),
  ])

  try {
    const profile = await getMyProfile()
    return NextResponse.json({
      cookies: cookieState,
      accessTokenPayload,
      raw: {
        userinfo: rawUserinfo,
        profile: rawProfile,
      },
      profile: {
        ok: true,
        id: profile?.id ?? null,
        email: profile?.email ?? null,
        username: profile?.username ?? null,
      },
    })
  } catch (error) {
    return NextResponse.json({
      cookies: cookieState,
      accessTokenPayload,
      raw: {
        userinfo: rawUserinfo,
        profile: rawProfile,
      },
      profile: {
        ok: false,
        status:
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          typeof error.status === "number"
            ? error.status
            : null,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
