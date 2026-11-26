import { NextRequest, NextResponse } from "next/server"
import { isJwtExpired } from "@/lib/auth/jwt-expiry"
import { requireBackendBaseUrl } from "@/lib/config/backend"
import { recordSmsRef, SMS_REF_COOKIE, smsRefCookieOptions } from "@/lib/sms-ref/sms-ref"

const REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "kr"

export const dynamic = "force-dynamic"

// middleware 가 /r/<코드> 를 /api/sms-link?code=<코드> 로 rewrite 해서 온다.
// ⚠️ 로컬 `next dev`(webpack·Turbopack 둘 다)에서는 rewrite 가 붙인 쿼리가 여기까지 오지 않는다 — request.url 이
// 원래 주소(/r/<코드>)라 code 가 비고 홈으로 간다(2026-11 실측). 라이브(OpenNext)는 쿼리가 온다(라이브 클릭 기록으로 확인).
// 로컬에서 확인할 땐 /api/sms-link?code=<코드> 를 직접 연다.
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
    const response = NextResponse.redirect(url, 302)
    // 이미 로그인한 브라우저면 지금 계정을 잇는다. 못 이으면(비로그인·토큰 만료·기록 실패) 쿠키를 남겨
    // 토큰 복구나 로그인·가입 콜백에서 잇는다 — middleware 의 /r rewrite 는 토큰 복구보다 앞이라 여기선 만료 토큰을 못 살린다.
    const accessToken = request.cookies.get("accessToken")?.value
    const recorded =
      !!accessToken && !isJwtExpired(accessToken) && (await recordSmsRef(code, accessToken, "clicked_signed_in"))
    if (!recorded) response.cookies.set(SMS_REF_COOKIE, code, smsRefCookieOptions())
    return response
  } catch {
    return NextResponse.redirect(home, 302)
  }
}
