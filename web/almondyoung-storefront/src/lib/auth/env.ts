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
  get userServiceUrl(): string {
    return required("USER_SERVICE_URL")
  },
  get parentCookieDomain(): string {
    return optional("PARENT_COOKIE_DOMAIN", "")
  },
  get parentCookieSecure(): boolean {
    return optional("PARENT_COOKIE_SECURE", "true") === "true"
  },
  get parentCookieSameSite(): "lax" | "none" | "strict" {
    return optional("PARENT_COOKIE_SAMESITE", "lax") as
      | "lax"
      | "none"
      | "strict"
  },
  get authWebOrigin(): string {
    return required("AUTH_WEB_ORIGIN")
  },
}
