import "server-only";

import { env } from "./env";
import {
  type AuthorizeParams,
  parseAuthorizeParams,
} from "./oauth-params";
import { sanitizeRedirectTo } from "./redirect";

export function parseAuthorizeRedirectTarget(
  raw: string | null | undefined,
): AuthorizeParams | null {
  const redirectTo = sanitizeRedirectTo(raw);
  if (!redirectTo) return null;

  let url: URL;
  try {
    url = new URL(redirectTo);
  } catch {
    return null;
  }

  if (url.origin !== env.selfOrigin || url.pathname !== "/oauth/authorize") {
    return null;
  }

  const parsed = parseAuthorizeParams(
    Object.fromEntries(url.searchParams.entries()),
  );
  return parsed.ok ? parsed.value : null;
}
