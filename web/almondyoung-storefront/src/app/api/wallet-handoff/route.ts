import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { ApiAuthError } from "@/lib/api/api-error"
import { issueWalletHandoffCode } from "@/lib/api/users/auth/payment-handoff"

export const dynamic = "force-dynamic"

const RESTORED_FLAG = "restored"

function walletCallbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_WALLET_WEB_URL || "http://localhost:3200"

  return new URL("/auth/callback", base).toString()
}

/**
 * wallet-web 진입 보증. wallet-web `/auth/handoff` 가 state·PKCE challenge·nonce 를 실어 보내면, 지금 쇼핑몰에
 * 로그인된 고객 몫의 인가 코드를 받아 wallet-web 콜백으로 돌려보낸다(OIDC authorize 응답과 같은 모양).
 * 돌려보낼 곳은 wallet-web 콜백 하나뿐이라 요청이 고를 수 없다.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const callback = walletCallbackUrl()
  const state = params.get("state")
  const codeChallenge = params.get("code_challenge")

  if (params.get("redirect_uri") !== callback || !state || !codeChallenge) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (params.get("code_challenge_method") !== "S256") {
    return redirectToWallet(callback, { error: "invalid_request", state })
  }

  try {
    const code = await issueWalletHandoffCode({
      redirectUri: callback,
      codeChallenge,
      nonce: params.get("nonce") ?? undefined,
      scope: params.get("scope") ?? undefined,
    })

    return redirectToWallet(callback, { code, state })
  } catch (error) {
    if (!(error instanceof ApiAuthError)) {
      return redirectToWallet(callback, { error: "server_error", state })
    }

    // access token 만 만료됐으면 한 번 복구하고 다시 온다.
    const jar = await cookies()
    if (jar.get("refreshToken")?.value && !params.has(RESTORED_FLAG)) {
      const retry = new URL(request.nextUrl.pathname, request.nextUrl.origin)
      params.forEach((value, key) => retry.searchParams.set(key, value))
      retry.searchParams.set(RESTORED_FLAG, "1")

      const restore = new URL("/api/auth/restore-token", request.nextUrl.origin)
      restore.searchParams.set("return_to", `${retry.pathname}${retry.search}`)

      return NextResponse.redirect(restore)
    }

    return redirectToWallet(callback, { error: "login_required", state })
  }
}

function redirectToWallet(callback: string, query: Record<string, string>) {
  const url = new URL(callback)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }

  return NextResponse.redirect(url)
}
