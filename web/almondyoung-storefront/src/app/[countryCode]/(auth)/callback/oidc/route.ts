import { NextRequest, NextResponse } from "next/server"

import { oidcCallback } from "@/lib/api/medusa/sso"

// OIDC 콜백 처리. Route Handler 로 두는 이유:
// page.tsx (Server Component) 에서 oidcCallback 을 직접 await 하면 Next.js 가 server-action 컨텍스트를
// 부여하지 않아 내부 cookies().set() 이 "Cookies can only be modified in a Server Action or Route Handler"
// 로 실패한다. Route Handler 는 cookie mutation 이 자유롭고 redirect 도 자연스럽다.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ countryCode: string }> },
) {
  const { countryCode } = await ctx.params
  const sp = req.nextUrl.searchParams
  const code = sp.get("code") ?? undefined
  const state = sp.get("state") ?? undefined
  const errorParam = sp.get("error") ?? undefined
  const errorDescription = sp.get("error_description") ?? undefined
  const redirectTo = sp.get("redirect_to") ?? undefined

  const renderError = (message: string) =>
    new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>로그인 실패</title>` +
        `<div style="max-width:480px;margin:48px auto;padding:24px;font-family:sans-serif;text-align:center">` +
        `<h1 style="font-size:18px;font-weight:600">로그인에 실패했습니다</h1>` +
        `<p style="margin-top:8px;font-size:14px;color:#666;word-break:break-all">${escapeHtml(message)}</p>` +
        `<p style="margin-top:16px"><a href="/${countryCode}/account/login" style="text-decoration:underline">다시 시도하기</a></p>` +
        `</div>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    )

  if (errorParam) {
    return renderError(errorDescription ?? errorParam)
  }
  if (!code || !state) {
    return renderError("code 또는 state 파라미터가 없습니다.")
  }

  const result = await oidcCallback({ code, state, countryCode, redirectTo })
  if (!result.success) {
    return renderError(result.error)
  }

  // NextResponse.redirect() 대신 replace()를 사용해 콜백 URL이 브라우저 history에 남지 않게 한다.
  // Safari back-swipe 등으로 콜백 URL에 재진입하면 이미 consumed된 code가 재제출되어
  // "invalid or already used code" 에러가 발생한다.
  const target = new URL(result.redirectTo, req.url).toString()
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><script>location.replace(${JSON.stringify(target)})</script>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
