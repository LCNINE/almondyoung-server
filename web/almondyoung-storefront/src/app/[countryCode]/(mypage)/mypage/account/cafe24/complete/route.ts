import { ApiAuthError, HttpApiError } from "@lib/api/api-error"
import { linkCafe24 } from "@lib/api/users/cafe24"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

const CAFE24_ENCRYPTED_ID_TOKEN_COOKIE = "cafe24_encrypted_id_token"

const buildStatusRedirect = (
  request: NextRequest,
  countryCode: string,
  status: string
) => {
  const url = new URL(`/${countryCode}/mypage/account/cafe24`, request.url)
  url.searchParams.set("link", status)
  return NextResponse.redirect(url, 303)
}

const clearTokenCookie = (response: NextResponse) => {
  response.cookies.set(CAFE24_ENCRYPTED_ID_TOKEN_COOKIE, "", {
    maxAge: -1,
    path: "/",
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: { countryCode: string } }
) {
  const countryCode = params?.countryCode ?? "kr"
  const encryptedIdToken = cookies().get(CAFE24_ENCRYPTED_ID_TOKEN_COOKIE)?.value

  if (!encryptedIdToken) {
    return buildStatusRedirect(request, countryCode, "missing_token")
  }

  try {
    await linkCafe24(encryptedIdToken)
    const response = buildStatusRedirect(request, countryCode, "success")
    clearTokenCookie(response)
    return response
  } catch (error) {
    let status = "failed"

    if (
      error instanceof ApiAuthError ||
      (error instanceof HttpApiError &&
        (error.status === 401 || error.status === 403))
    ) {
      status = "login_required"
    } else if (error instanceof HttpApiError && error.status === 400) {
      status = "invalid_token"
    }

    console.error("Cafe24 link failed:", error)
    const response = buildStatusRedirect(request, countryCode, status)
    clearTokenCookie(response)
    return response
  }
}
