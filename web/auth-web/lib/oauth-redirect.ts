import "server-only";

import {
  type AuthorizeParams,
  parseAuthorizeParams,
} from "./oauth-params";
import { getSite, sanitizeRedirectTo } from "./site/site";

/** redirect_to 가 «이 주소의» `/oauth/authorize` 면 그 파라미터. 테넌트 도메인이면 기원은 그 도메인이다. */
export async function parseAuthorizeRedirectTarget(
  raw: string | null | undefined,
): Promise<AuthorizeParams | null> {
  const redirectTo = await sanitizeRedirectTo(raw);
  if (!redirectTo) return null;

  const site = await getSite();
  if (site.kind === "unavailable") return null;

  let url: URL;
  try {
    url = new URL(redirectTo);
  } catch {
    return null;
  }

  if (url.origin !== site.origin || url.pathname !== "/oauth/authorize") {
    return null;
  }

  const parsed = parseAuthorizeParams(
    Object.fromEntries(url.searchParams.entries()),
  );
  return parsed.ok ? parsed.value : null;
}
