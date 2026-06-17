import { NextResponse, type NextRequest } from "next/server"

import { invalidateAccountRefreshToken } from "@/lib/account-store"
import { env } from "@/lib/env"
import {
  clearIdpSessionCookies,
  getIdpAccessToken,
  hasIdpRefreshToken,
} from "@/lib/idp-session"
import { getMe, restoreAccessToken } from "@/lib/user-service"

/**
 * OIDC RP-Initiated Logout — auth-web 가 소유하는 end_session_endpoint.
 *
 * authorize 가 auth-web 에 있으므로 로그아웃도 반드시 auth-web 을 거쳐야 한다. 그래야:
 *  1) auth-web host-only 세션 쿠키(accessToken/refreshToken) 를 실제로 만료시킬 수 있다.
 *     (user-service 도메인으로 직접 보내면 cross-domain 이라 이 쿠키를 못 지운다 → 자동 재로그인 버그)
 *  2) 활성 계정의 host-only access token 을 Bearer 로 실어 user-service /oauth/end_session 을
 *     server-to-server 호출 → DB 토큰(oauth_tokens/tokens) 을 확실히 revoke 한다.
 *     (브라우저가 user-service 로 직접 navigate 하면 Bearer 가 없어 userId 식별 실패 → revoke 스킵)
 *  3) 계정 허브의 per-account refresh token(_rt) 쿠키를 무효화한다. 그래서 다음에 계정 리스트에서
 *     같은 계정을 눌러도 비밀번호 재입력(/signin reauth) 을 거친다 — 공용 PC 보안 흐름.
 *     메타(loginId/email)는 남겨 리스트에는 계속 표시된다.
 */
async function handleEndSession(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const clientId = url.searchParams.get("client_id") ?? undefined
  const postLogoutRedirectUri =
    url.searchParams.get("post_logout_redirect_uri") ?? undefined
  const state = url.searchParams.get("state") ?? undefined

  // 활성 계정의 userId + 유효한 access token 확보.
  // access 쿠키가 만료됐으면 refresh 로 복원해 신선한 토큰으로 revoke 를 보장한다.
  let accessToken = await getIdpAccessToken()
  let userId: string | null = null
  if (accessToken) {
    try {
      userId = (await getMe(accessToken)).id
    } catch {
      accessToken = null
    }
  }
  if (!userId) {
    const refreshToken = await hasIdpRefreshToken()
    if (refreshToken) {
      const restored = await restoreAccessToken(refreshToken)
      if (restored.ok) {
        accessToken = restored.accessToken
        try {
          userId = (await getMe(accessToken)).id
        } catch {
          userId = null
        }
      }
    }
  }

  // user-service end_session (server-to-server). Bearer 가 있어야 userId 식별 → DB revoke.
  // post_logout_redirect_uri 검증/화이트리스트 매칭은 user-service 가 수행해 validated redirectUrl 을 돌려준다.
  let validatedRedirect: string | null = null
  try {
    const res = await fetch(`${env.userServiceUrl}/oauth/end_session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        client_id: clientId,
        post_logout_redirect_uri: postLogoutRedirectUri,
        state,
      }),
      cache: "no-store",
    })
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as {
        redirectUrl?: string | null
      } | null
      validatedRedirect = body?.redirectUrl ?? null
    }
  } catch {
    // user-service 도달 실패해도 클라이언트 쿠키는 비운다 (idempotent logout).
  }

  // auth-web 자체 세션 쿠키(active session) 만료 + 계정 허브 per-account RT 무효화.
  await clearIdpSessionCookies()
  if (userId) await invalidateAccountRefreshToken(userId)

  return NextResponse.redirect(validatedRedirect ?? env.selfOrigin, {
    status: 302,
  })
}

// 브라우저 navigate(GET) 와 서버 간 호출(POST) 모두 지원.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleEndSession(req)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleEndSession(req)
}
