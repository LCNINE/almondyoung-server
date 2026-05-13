import { refreshCartPrices } from "@/lib/api/medusa/cart"

const POLL_INTERVAL_MS = 3_000
const MAX_DURATION_MS = 30_000

export function pollCartRefreshUntilGroupRemoved(
  onGroupRemoved?: () => void,
  intervalMs = POLL_INTERVAL_MS,
  maxDurationMs = MAX_DURATION_MS,
): void {
  const startedAt = Date.now()
  const poll = () => {
    setTimeout(async () => {
      const result = await refreshCartPrices().catch(() => null)
      if (result === null) {
        if (Date.now() - startedAt < maxDurationMs) poll()
        return
      }
      if (result.hasMembershipGroup !== true) {
        onGroupRemoved?.()
        return
      }
      if (Date.now() - startedAt < maxDurationMs) poll()
    }, intervalMs)
  }
  poll()
}
