import { NextRequest, NextResponse } from "next/server"
import { requireBackendBaseUrl } from "@/lib/config/backend"

const REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const home = new URL(`/${REGION}`, request.nextUrl.origin)
  const code = request.nextUrl.searchParams.get("code")
  if (!code) return NextResponse.redirect(home, 302)

  try {
    const res = await fetch(
      `${requireBackendBaseUrl("notification")}/sms-gate/links/${encodeURIComponent(code)}/click`,
      {
        method: "POST",
        headers: { "user-agent": request.headers.get("user-agent") ?? "" },
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      }
    )
    if (!res.ok) return NextResponse.redirect(home, 302)
    const { url } = (await res.json()) as { url: string }
    return NextResponse.redirect(url, 302)
  } catch {
    return NextResponse.redirect(home, 302)
  }
}
