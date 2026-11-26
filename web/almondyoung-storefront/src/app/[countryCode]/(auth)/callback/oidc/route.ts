import { NextRequest, NextResponse } from "next/server"
import { createTranslator } from "next-intl"

import accountEn from "@/i18n/messages/en/account.json"
import accountJa from "@/i18n/messages/ja/account.json"
import accountKo from "@/i18n/messages/ko/account.json"
import { oidcCallback } from "@/lib/api/medusa/sso"
import { settleSmsRef } from "@/lib/sms-ref/sms-ref"
import { countryCodeToLocale } from "@/lib/utils/locale-path"

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

  const renderError = (reason: string) => {
    console.error("[oidc callback] login failed:", reason)

    const locale = countryCodeToLocale(countryCode)
    const account = { ko: accountKo, en: accountEn, ja: accountJa }[locale]
    const t = createTranslator({ locale, messages: { account }, namespace: "account.loginFailed" })

    return new NextResponse(
      `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t("title")}</title>` +
        `<div style="max-width:420px;min-height:100vh;margin:0 auto;padding:0 24px 40px;box-sizing:border-box;display:flex;flex-direction:column;font-family:sans-serif;color:#111">` +
        `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">` +
        `<h1 style="margin:0;font-size:20px;font-weight:700">${t("title")}</h1>` +
        `<p style="margin:8px 0 0;font-size:15px;color:#4b5563">${t("body")}</p>` +
        `</div>` +
        `<a href="/${encodeURIComponent(countryCode)}/account/login" style="display:flex;align-items:center;justify-content:center;height:52px;border-radius:10px;background:#ffa500;color:#fff;font-size:16px;font-weight:700;text-decoration:none">${t("retry")}</a>` +
        `</div>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    )
  }

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
  // Next.js의 req.url은 LAN으로 접속해도 localhost로 정규화될 수 있다.
  // 검증된 상대 경로를 그대로 사용해 로그인한 브라우저의 실제 접속 호스트를 유지한다.
  const target = result.redirectTo
  const response = new NextResponse(
    `<!doctype html><meta charset="utf-8"><script>location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")})</script>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  )
  // 추적 링크를 누른 뒤 로그인·가입했으면 그 계정을 잇는다. 쇼핑몰 고객을 이 콜백에서 새로 만들었으면 가입으로 본다.
  await settleSmsRef(req, response, result.accessToken, result.createdCustomer ? "signup" : "login")
  return response
}
