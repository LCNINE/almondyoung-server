import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

function expiresAt(token: string | undefined) {
  const payload = token?.split(".")[1]
  if (!payload) return null
  try {
    const { exp } = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { exp?: number }
    return typeof exp === "number" ? exp : null
  } catch {
    return null
  }
}

export function GET(request: NextRequest) {
  const exp = expiresAt(request.cookies.get("accessToken")?.value)
  return NextResponse.json(
    {
      expiresIn: exp === null ? null : exp - Math.floor(Date.now() / 1000),
      refreshable: !!request.cookies.get("refreshToken")?.value,
    },
    { headers: { "cache-control": "no-store" } }
  )
}
