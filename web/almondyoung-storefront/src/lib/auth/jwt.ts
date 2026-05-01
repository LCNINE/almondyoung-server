// SOURCE OF TRUTH: almondyoung-server/web/auth-web/lib/jwt.ts
// Keep in sync. Update auth-web first, then mirror here.
import "server-only"

type RefreshPayload = { sub: string; exp?: number }

export function decodeJwtPayload<T = RefreshPayload>(token: string): T | null {
  try {
    const part = token.split(".")[1]
    if (!part) return null
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
    const json = Buffer.from(padded, "base64").toString("utf-8")
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

export function isExpired(exp: number | undefined): boolean {
  if (typeof exp !== "number") return true
  return Date.now() >= exp * 1000
}
