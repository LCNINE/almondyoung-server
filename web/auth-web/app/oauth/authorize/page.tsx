import { redirect } from "next/navigation";

import { issueOAuthCodeAndRedirect } from "@/app/actions";
import { listAccounts } from "@/lib/account-store";
import {
  buildAuthorizeUrl,
  buildErrorRedirect,
  parseAuthorizeParams,
} from "@/lib/oauth-params";
import { getActiveSessionUserId } from "@/lib/session";
import { env } from "@/lib/env";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;
  const parsed = parseAuthorizeParams(raw);

  if (!parsed.ok) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-4 px-6 py-12">
        <h1 className="text-xl font-semibold">잘못된 요청</h1>
        <p className="text-sm text-muted-foreground">{parsed.error}</p>
      </main>
    );
  }

  const params = parsed.value;
  const back = `${env.selfOrigin}${buildAuthorizeUrl(params)}`;

  // prompt=login: 항상 signin 강제. hub로 force_login 신호와 함께.
  if (params.prompt === "login") {
    const sp = new URLSearchParams({ redirect_to: back, force_login: "1" });
    redirect(`/?${sp.toString()}`);
  }

  // prompt=select_account: 항상 hub.
  if (params.prompt === "select_account") {
    redirect(`/?redirect_to=${encodeURIComponent(back)}`);
  }

  // 활성 세션 감지: parent cookie 의 토큰을 user-service /users/me 호출로 검증 위임.
  // 로컬 JWT payload 디코드를 신뢰하지 않는다 (서명 검증은 user-service 가 수행).
  const activeUserId = await getActiveSessionUserId();

  // prompt=none: 세션 없으면 OIDC error로 redirect_uri로 회신.
  if (params.prompt === "none" && !activeUserId) {
    redirect(buildErrorRedirect(params.redirectUri, params.state, "login_required"));
  }

  // Silent SSO 조건: 활성 세션이 있고, (prompt=none이 명시됐거나 저장된 계정이 1개 이하).
  // 다중 계정이 저장돼 있으면 default 동작은 hub — 사용자가 계정 전환할 여지를 남김.
  // (prompt=none은 RP가 "UI 절대 띄우지 말라"는 신호이므로 다중 계정이어도 active 계정으로 즉시 발급.)
  if (activeUserId) {
    const accounts = await listAccounts();
    const allowSilent = params.prompt === "none" || accounts.length <= 1;
    if (allowSilent) {
      await issueOAuthCodeAndRedirect(activeUserId, {
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        scope: params.scope,
        state: params.state,
      });
      // unreachable
    }
  }

  // 다중 계정 또는 세션 없음 → hub.
  redirect(`/?redirect_to=${encodeURIComponent(back)}`);
}
