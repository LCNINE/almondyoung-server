import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  userServiceUrl: required("USER_SERVICE_URL"),
  // auth-web 자체 host-only 세션 쿠키 옵션. parent-domain 공유는 폐기됨 — RP 들은
  // OIDC code flow 로 자기 도메인에 자기 세션을 둔다. 여기는 IdP 자체 SSO 식별용 쿠키 옵션.
  cookieSecure: optional("COOKIE_SECURE", "true") === "true",
  cookieSameSite: optional("COOKIE_SAMESITE", "lax") as
    | "lax"
    | "none"
    | "strict",
  allowedRedirectHosts: optional("ALLOWED_REDIRECT_HOSTS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  oauthInternalSecret: optional("OAUTH_INTERNAL_SECRET", ""),
  selfOrigin: required("AUTH_WEB_ORIGIN"),
};
