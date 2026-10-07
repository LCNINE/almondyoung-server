import type { StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"

type CancelState = Pick<StoreOrderActionsResponse, "orderStatus" | "cancelRequestStatus">

export type CancelOutcome = "cancelled" | "rejected" | "pending"

/** 취소는 비동기다(#1016 35번, ADR-0042) — 채널이 취소·환불하고 core 가 수집으로 반영한다. */
export function cancelOutcomeOf(actions: CancelState): CancelOutcome {
  if (actions.orderStatus === "cancelled") return "cancelled"
  if (actions.cancelRequestStatus === "rejected") return "rejected"
  return "pending"
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 스펙 §7.5: 2초마다 최대 30초 다시 읽는다. 30초를 넘기면 읽기만 멈춘다(pending). */
export async function waitForCancelOutcome(
  read: () => Promise<CancelState | null>,
  opts: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<CancelOutcome> {
  const intervalMs = opts.intervalMs ?? 2000
  const attempts = Math.floor((opts.timeoutMs ?? 30_000) / intervalMs)
  const sleep = opts.sleep ?? defaultSleep
  for (let i = 0; i < attempts; i += 1) {
    await sleep(intervalMs)
    const state = await read()
    if (!state) continue
    const outcome = cancelOutcomeOf(state)
    if (outcome !== "pending") return outcome
  }
  return "pending"
}
