import "server-only"

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

export const authEnv = {
  userServiceUrl: required("USER_SERVICE_URL"),
  parentCookieDomain: required("PARENT_COOKIE_DOMAIN"),
  parentCookieSecure: optional("PARENT_COOKIE_SECURE", "true") === "true",
  parentCookieSameSite: optional("PARENT_COOKIE_SAMESITE", "lax") as
    | "lax"
    | "none"
    | "strict",
  authWebOrigin: required("AUTH_WEB_ORIGIN"),
}
