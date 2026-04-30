import "server-only";

import { env } from "./env";

/**
 * redirect_to URL 검증. 허용 호스트 화이트리스트에 포함되지 않으면 null.
 * 허용 호스트는 exact match 또는 ".example.com" suffix match (서브도메인 포함).
 */
export function sanitizeRedirectTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (env.oauthBypassValidation) return url.toString();
  const host = url.host;
  const match = env.allowedRedirectHosts.some((allowed) => {
    if (allowed.startsWith(".")) return host === allowed.slice(1) || host.endsWith(allowed);
    return host === allowed;
  });
  return match ? url.toString() : null;
}
