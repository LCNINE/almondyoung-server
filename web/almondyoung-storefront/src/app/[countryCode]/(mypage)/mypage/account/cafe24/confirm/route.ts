import { ApiAuthError, HttpApiError } from "@lib/api/api-error"
import { linkCafe24 } from "@lib/api/users/cafe24"
import { NextRequest, NextResponse } from "next/server"

const buildStatusRedirect = (
  request: NextRequest,
  countryCode: string,
  status: string
) => {
  const url = new URL(`/${countryCode}/mypage/account/cafe24`, request.url)
  url.searchParams.set("link", status)
  return NextResponse.redirect(url, 303)
}

const buildLoginRedirect = (
  request: NextRequest,
  countryCode: string,
  status: string
) => {
  const url = new URL(`/${countryCode}/login`, request.url)
  const redirectTo = `/${countryCode}/mypage/account/cafe24?link=${status}`
  url.searchParams.set("redirect_to", redirectTo)
  return NextResponse.redirect(url, 303)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { countryCode: string } }
) {
  const countryCode = params?.countryCode ?? "kr"

  const formData = await request.formData()
  const cafe24LinkToken = formData.get("cafe24_link_token")

  if (!cafe24LinkToken || typeof cafe24LinkToken !== "string") {
    return buildStatusRedirect(request, countryCode, "missing_token")
  }

  try {
    await linkCafe24(cafe24LinkToken)
    return buildStatusRedirect(request, countryCode, "success")
  } catch (error) {
    if (
      error instanceof ApiAuthError ||
      (error instanceof HttpApiError &&
        (error.status === 401 || error.status === 403))
    ) {
      return buildLoginRedirect(request, countryCode, "login_required")
    }

    if (error instanceof HttpApiError && error.status === 400) {
      return buildStatusRedirect(request, countryCode, "invalid_token")
    }

    console.error("Cafe24 link failed:", error)
    return buildStatusRedirect(request, countryCode, "failed")
  }
}
