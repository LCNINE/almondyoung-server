import "server-only"

import { redirect } from "next/navigation"

import {
  buildAuthorizeUrl,
  buildErrorRedirect,
  type PromptValue,
} from "./oauth-params"
import { parseAuthorizeRedirectTarget } from "./oauth-redirect"
import {
  codeRedirectAllowedHere,
  getSite,
  sanitizeRedirectTo,
} from "./site/site"
import { issueOAuthCodeInternal, type UserProfile } from "./user-service"

// "use server" 파일(app/actions.ts)에 두지 않는다 — 거기서 export 하면 브라우저가 부를 수 있는 서버 액션이 되고,
// 인자(누구에게·비밀번호 변경 필요 여부)를 호출자가 정하게 된다.

export type AuthenticatedUser = Pick<UserProfile, "id" | "mustChangePassword">

export type IssueParams = {
  clientId: string
  redirectUri: string
  codeChallenge: string
  scope?: string
  state: string
  nonce?: string
  prompt?: PromptValue
}

// OAuth code 발급 후 redirect_uri로 302. 성공/실패 모두 throw redirect.
export async function issueOAuthCodeAndRedirect(
  user: AuthenticatedUser,
  params: IssueParams
): Promise<never> {
  const site = await getSite()
  if (site.kind === "unavailable") redirect("/")
  const back = `${site.origin}${buildAuthorizeUrl({
    ...params,
    codeChallengeMethod: "S256",
    responseType: "code",
    prompt: undefined,
  })}`
  // authorize 화면이 먼저 거르지만, redirect_to 로 들어온 authorize 주소는 여기서야 처음 본다 — 그 화면으로 돌려보내
  // «잘못된 요청»을 보인다.
  if (!(await codeRedirectAllowedHere(params.redirectUri))) redirect(back)

  // 초기 비밀번호면 코드를 내주기 전에 바꾸게 한다 — 테넌트 셸에는 비밀번호 변경 화면이 없다.
  // 기본 주소는 admin-web 이 자기 화면에서 바꾸게 한다(지금 그대로).
  if (site.kind === "tenant" && user.mustChangePassword) {
    if (params.prompt === "none") {
      redirect(
        buildErrorRedirect(
          params.redirectUri,
          params.state,
          "interaction_required"
        )
      )
    }
    redirect(`/change-password?${new URLSearchParams({ redirect_to: back })}`)
  }

  const { code } = await issueOAuthCodeInternal({
    clientId: params.clientId,
    userId: user.id,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: "S256",
    scope: params.scope,
    nonce: params.nonce,
  })

  const url = new URL(params.redirectUri)
  url.searchParams.set("code", code)
  url.searchParams.set("state", params.state)
  redirect(url.toString())
}

/** 로그인 직후 — redirect_to 가 이 주소의 authorize 면 코드를 내주고, 아니면 허용된 주소(없으면 첫 화면)로. */
export async function redirectAfterAuth(
  user: AuthenticatedUser,
  redirectToRaw: string | null | undefined
): Promise<never> {
  const oauthParams = await parseAuthorizeRedirectTarget(redirectToRaw)
  if (oauthParams) {
    return issueOAuthCodeAndRedirect(user, oauthParams)
  }

  const redirectTo = await sanitizeRedirectTo(redirectToRaw)
  redirect(redirectTo ?? "/")
}
