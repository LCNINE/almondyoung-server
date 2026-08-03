export type BridgeMessage = { type: "auth/logout" }

const KNOWN_TYPES = new Set(["auth/logout"])

/**
 * 웹→앱 브릿지 메시지. 앱과 웹의 배포 시점이 다르므로 모르는 type 은 조용히 무시한다.
 * 세션 토큰은 절대 이 경로로 오가지 않는다 — 상태 통지 전용이다.
 */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const type = (parsed as { type?: unknown }).type
  if (typeof type !== "string" || !KNOWN_TYPES.has(type)) return null
  return { type: type as BridgeMessage["type"] }
}
