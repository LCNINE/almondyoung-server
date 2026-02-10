import { HttpApiError } from "@lib/api/api-error"
import {
  bootstrapCafe24Signup,
  type Cafe24SignupBootstrapData,
} from "@lib/api/users/auth/signup-cafe24"
import { NextRequest, NextResponse } from "next/server"

const CAFE24_SIGNUP_COOKIE = "cafe24_signup_bootstrap"

type RedirectStatus = "ready" | "missing_token" | "bootstrap_failed"

const buildSignupRedirect = (
  request: NextRequest,
  countryCode: string,
  options: {
    status: RedirectStatus
    redirectTo: string
    signupMode?: "cafe24"
    message?: string
  }
) => {
  const url = new URL(`/${countryCode}/signup`, request.url)

  if (options.redirectTo) {
    url.searchParams.set("redirect_to", options.redirectTo)
  }

  if (options.signupMode) {
    url.searchParams.set("signup_mode", options.signupMode)
  }

  url.searchParams.set("legacy_status", options.status)

  if (options.message) {
    url.searchParams.set("legacy_message", options.message)
  }

  return NextResponse.redirect(url, 303)
}

const getFirstFormValue = (formData: FormData, keys: string[]) => {
  for (const key of keys) {
    const value = formData.get(key)

    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return null
}

const getFirstSearchParamValue = (
  request: NextRequest,
  keys: string[]
): string | null => {
  for (const key of keys) {
    const value = request.nextUrl.searchParams.get(key)

    if (value && value.trim()) {
      return value.trim()
    }
  }

  return null
}

const setBootstrapCookie = (
  response: NextResponse,
  data: Cafe24SignupBootstrapData
) => {
  const serialized = encodeURIComponent(JSON.stringify(data))

  response.cookies.set(CAFE24_SIGNUP_COOKIE, serialized, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { countryCode: string } }
) {
  const countryCode = params?.countryCode ?? "kr"
  const redirectTo = request.nextUrl.searchParams.get("redirect_to") ?? "/"

  const formData = await request.formData()
  const encryptedIdToken =
    getFirstFormValue(formData, ["encryptedIdToken", "encrypted_id_token"]) ??
    getFirstSearchParamValue(request, ["encryptedIdToken", "encrypted_id_token"])

  if (!encryptedIdToken) {
    return buildSignupRedirect(request, countryCode, {
      status: "missing_token",
      redirectTo,
      message: "기존 아몬드영 인증 토큰을 찾을 수 없습니다.",
    })
  }

  try {
    const bootstrapData = await bootstrapCafe24Signup({
      encryptedIdToken,
    })

    const cookieData: Cafe24SignupBootstrapData = {
      encryptedIdToken,
      ...bootstrapData,
    }

    const response = buildSignupRedirect(request, countryCode, {
      status: "ready",
      redirectTo,
      signupMode: "cafe24",
    })

    setBootstrapCookie(response, cookieData)
    return response
  } catch (error) {
    const message =
      error instanceof HttpApiError
        ? error.message
        : "기존 아몬드영 정보를 불러오지 못했습니다."

    const response = buildSignupRedirect(request, countryCode, {
      status: "bootstrap_failed",
      redirectTo,
      message,
    })

    response.cookies.set(CAFE24_SIGNUP_COOKIE, "", {
      maxAge: -1,
      path: "/",
    })

    return response
  }
}
