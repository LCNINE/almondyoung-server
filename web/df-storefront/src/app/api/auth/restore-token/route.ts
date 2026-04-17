import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getTokenCookieDomain } from "@lib/data/cookies"

const MEDUSA_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ""

const getUsersServiceUrl = () =>
  process.env.USERS_SERVICE_URL ??
  process.env.NEXT_PUBLIC_USERS_SERVICE_URL ??
  "http://localhost:3030"

const getMedusaBackendUrl = () =>
  process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"

const clearAuthCookies = async (response: NextResponse) => {
  const domain = await getTokenCookieDomain()

  response.cookies.set("accessToken", "", {
    maxAge: -1,
    path: "/",
  })
  response.cookies.set("refreshToken", "", {
    maxAge: -1,
    path: "/",
  })
  response.cookies.set("_medusa_jwt", "", {
    maxAge: -1,
    path: "/",
  })

  if (domain) {
    response.cookies.set("accessToken", "", {
      maxAge: -1,
      path: "/",
      domain,
    })
    response.cookies.set("refreshToken", "", {
      maxAge: -1,
      path: "/",
      domain,
    })
  }
}

async function fetchMedusaToken(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(`${getMedusaBackendUrl()}/auth/customer/my-auth`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "x-publishable-api-key": MEDUSA_PUBLISHABLE_KEY,
      },
      cache: "no-store",
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.token ?? data.data?.token ?? null
  } catch {
    return null
  }
}

export async function POST(_request: NextRequest) {
  const cookieStore = await cookies()
  const refreshToken = cookieStore.get("refreshToken")?.value

  if (!refreshToken) {
    const response = NextResponse.json(
      { success: false, message: "No refresh token" },
      { status: 401 }
    )

    await clearAuthCookies(response)
    return response
  }

  try {
    const restoreResponse = await fetch(`${getUsersServiceUrl()}/auth/restore-token`, {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${refreshToken}`,
      },
      cache: "no-store",
    })

    const restoreResult = await restoreResponse.json().catch(() => ({}))

    if (!restoreResponse.ok) {
      throw new Error(restoreResult.message || "Restore token failed")
    }

    const accessToken = restoreResult.data?.accessToken ?? restoreResult.accessToken

    if (!accessToken) {
      throw new Error("No access token returned")
    }

    const response = NextResponse.json(
      { success: true, message: "Token restored successfully" },
      { status: 200 }
    )

    const domain = await getTokenCookieDomain()

    response.cookies.set("accessToken", accessToken, {
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      ...(domain ? { domain } : {}),
    })

    const medusaToken = await fetchMedusaToken(accessToken)

    if (medusaToken) {
      response.cookies.set("_medusa_jwt", medusaToken, {
        maxAge: 60 * 60 * 24 * 30,
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      })
    }

    return response
  } catch {
    const response = NextResponse.json(
      { success: false, message: "Token expired, login required" },
      { status: 401 }
    )

    await clearAuthCookies(response)
    return response
  }
}
