import { redirect } from "next/navigation";

import { decodeJwtPayload, isExpired } from "@/lib/jwt";
import { hasParentRefreshToken } from "@/lib/parent-cookies";
import {
  buildAuthorizeUrl,
  parseAuthorizeParams,
} from "@/lib/oauth-params";
import { env } from "@/lib/env";

import { issueOAuthCodeAction } from "./actions";

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

  // 1. 로그인 상태 확인 (parent refresh token)
  const parentRt = await hasParentRefreshToken();
  const payload = parentRt ? decodeJwtPayload<{ sub: string; exp?: number }>(parentRt) : null;
  const loggedIn = !!payload?.sub && !isExpired(payload.exp);

  if (!loggedIn) {
    // 계정 허브로 보내고, 로그인 후 다시 이 authorize URL로 복귀
    const back = `${env.selfOrigin}${buildAuthorizeUrl(params)}`;
    const huburl = `/?redirect_to=${encodeURIComponent(back)}`;
    redirect(huburl);
  }

  // 2. 로그인되어 있음 → code 발급 후 redirect_uri로 302
  await issueOAuthCodeAction(payload!.sub, params);

  // redirect()는 던지므로 여기 도달 안 함
  return null;
}
