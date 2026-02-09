import { NextRequest, NextResponse } from "next/server"

const CAFE24_LINK_TOKEN_COOKIE = "cafe24_link_token"

const buildStatusRedirect = (
  request: NextRequest,
  countryCode: string,
  status: string
) => {
  const url = new URL(`/${countryCode}/mypage/account/cafe24`, request.url)
  url.searchParams.set("link", status)
  return NextResponse.redirect(url, 303)
}

const buildCompleteRedirect = (request: NextRequest, countryCode: string) => {
  const url = new URL(
    `/${countryCode}/mypage/account/cafe24/complete`,
    request.url
  )
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

  const response = buildCompleteRedirect(request, countryCode)
  response.cookies.set(CAFE24_LINK_TOKEN_COOKIE, cafe24LinkToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 5,
    path: "/",
  })
  return response
}
