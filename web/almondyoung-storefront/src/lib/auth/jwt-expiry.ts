/** JWT 의 exp 가 지났는지(skew 포함). 토큰이 없거나 읽을 수 없으면 만료로 본다. middleware·추적 링크가 함께 쓴다. */
export function isJwtExpired(token?: string, skewSeconds = 30): boolean {
  if (!token) return true

  try {
    const payload = token.split(".")[1]
    if (!payload) return true
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    )
    const decoded = JSON.parse(atob(padded)) as { exp?: number }

    if (!decoded.exp) return true

    return decoded.exp <= Math.floor(Date.now() / 1000) + skewSeconds
  } catch {
    return true
  }
}
