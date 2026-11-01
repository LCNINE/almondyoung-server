import { redirect } from "next/navigation"

import { issueOAuthCodeAndRedirect } from "@/lib/oauth-issue"
import { listAccounts } from "@/lib/account-store"
import {
  buildAuthorizeUrl,
  buildErrorRedirect,
  parseAuthorizeParams,
} from "@/lib/oauth-params"
import { getActiveSessionUser } from "@/lib/session"
import { codeRedirectAllowedHere, getSite } from "@/lib/site/site"
import { validateRedirectUriInternal } from "@/lib/user-service"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const raw = await searchParams
  // 중립 오류 화면 — 레이아웃이 그 화면을 그린다. 여기서 redirect 하면 레이아웃과 상관없이 나가므로 아무것도 하지 않는다.
  const site = await getSite()
  if (site.kind === "unavailable") return null
  const parsed = parseAuthorizeParams(raw)

  if (!parsed.ok) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-4 px-6 py-12">
        <h1 className="text-xl font-semibold">잘못된 요청</h1>
        <p className="text-sm text-muted-foreground">{parsed.error}</p>
      </main>
    )
  }

  const params = parsed.value
  const back = `${site.origin}${buildAuthorizeUrl(params)}`

  // redirect_uri 사전 검증.
  // user-service 는 issueAuthorizationCode 단계에서 등록 화이트리스트를 강제하지만, 그 전에
  // OIDC error redirect (`buildErrorRedirect`) 가 미검증 URI 로 외부 302 를 보낼 수 있어
  // open redirect 가 됐다. 여기서 한 번 끊어 임의 URL 로의 외부 302 를 차단한다.
  // 검증 실패 시 redirect 없이 로컬 에러 화면 렌더 — 표준 RP 의 silent iframe 은 timeout 처리됨.
  const redirectUriValid = await validateRedirectUriInternal({
    clientId: params.clientId,
    redirectUri: params.redirectUri,
  })
  if (!redirectUriValid) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-4 px-6 py-12">
        <h1 className="text-xl font-semibold">잘못된 요청</h1>
        <p className="text-sm text-muted-foreground">
          등록되지 않은 redirect_uri 입니다. 클라이언트 설정을 확인해주세요.
        </p>
      </main>
    )
  }

  // 같은 admin-web 클라이언트에 모든 테넌트의 주소가 등록돼 있어 user-service 검증만으로는 화면과 토큰 테넌트가 어긋난다 —
  // 테넌트 화면은 그 테넌트 도메인으로만, 기본 화면은 다른 테넌트 도메인으로는 보내지 않는다(`codeRedirectAllowed`).
  if (!(await codeRedirectAllowedHere(params.redirectUri))) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-4 px-6 py-12">
        <h1 className="text-xl font-semibold">잘못된 요청</h1>
        <p className="text-sm text-muted-foreground">
          이 주소에서 쓸 수 없는 redirect_uri 입니다.
        </p>
      </main>
    )
  }

  // prompt=login: 항상 signin 강제. hub로 force_login 신호와 함께.
  if (params.prompt === "login") {
    const sp = new URLSearchParams({ redirect_to: back, force_login: "1" })
    redirect(`/?${sp.toString()}`)
  }

  // prompt=select_account: 항상 hub.
  if (params.prompt === "select_account") {
    redirect(`/?redirect_to=${encodeURIComponent(back)}`)
  }

  // 활성 세션 감지: parent cookie 의 토큰을 user-service /users/me 호출로 검증 위임.
  // 로컬 JWT payload 디코드를 신뢰하지 않는다 (서명 검증은 user-service 가 수행).
  const activeUser = await getActiveSessionUser()

  // prompt=none: 세션 없으면 OIDC error로 redirect_uri로 회신.
  if (params.prompt === "none" && !activeUser) {
    redirect(
      buildErrorRedirect(params.redirectUri, params.state, "login_required")
    )
  }

  // Silent SSO 조건: 활성 세션이 있고, (prompt=none이 명시됐거나 저장된 계정이 1개 이하).
  // 다중 계정이 저장돼 있으면 default 동작은 hub — 사용자가 계정 전환할 여지를 남김.
  // (prompt=none은 RP가 "UI 절대 띄우지 말라"는 신호이므로 다중 계정이어도 active 계정으로 즉시 발급.)
  if (activeUser) {
    const accounts = await listAccounts()
    const allowSilent = params.prompt === "none" || accounts.length <= 1
    if (allowSilent) {
      await issueOAuthCodeAndRedirect(activeUser, {
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        scope: params.scope,
        state: params.state,
        nonce: params.nonce,
        prompt: params.prompt,
      })
      // unreachable
    }
  }

  // 다중 계정 또는 세션 없음 → hub.
  redirect(`/?redirect_to=${encodeURIComponent(back)}`)
}
