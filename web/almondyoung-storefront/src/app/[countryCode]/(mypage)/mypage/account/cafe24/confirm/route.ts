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

const buildCompleteRedirect = (request: NextRequest, countryCode: string) => {
  const url = new URL(
    `/${countryCode}/mypage/account/cafe24/complete`,
    request.url
  )
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

export async function POST(
  request: NextRequest,
  { params }: { params: { countryCode: string } }
) {
  const countryCode = params?.countryCode ?? "kr"

  const formData = await request.formData()
  const encryptedIdToken =
    getFirstFormValue(formData, ["encryptedIdToken", "encrypted_id_token"]) ??
    getFirstSearchParamValue(request, ["encryptedIdToken", "encrypted_id_token"])

  if (!encryptedIdToken) {
    return buildStatusRedirect(request, countryCode, "missing_token")
  }

  const response = buildCompleteRedirect(request, countryCode)
  response.cookies.set(CAFE24_ENCRYPTED_ID_TOKEN_COOKIE, encryptedIdToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 5,
    path: "/",
  })
  return response
}
