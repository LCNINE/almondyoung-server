import type { CustomerReturn } from "@/lib/types/ui/returns"

export type ItemReturnStatusKey = "returning" | "returned" | "exchanging" | "exchanged"

export interface ItemReturnStatus {
  key: ItemReturnStatusKey
  /** 이 상태에 든 수량 — 줄 수량보다 적으면 일부만 반품·교환한 것이다 */
  quantity: number
  /** 반품 상세 보기로 갈 반품 — 그 줄에 닿은 가장 최근 반품 */
  returnId: string
  /** 진행 중이면 그 단계, 끝났으면 환불한 때 */
  stage: CustomerReturn["stage"]
  refundedAt: string | null
}

const ACTIVE: ReadonlySet<CustomerReturn["stage"]> = new Set<CustomerReturn["stage"]>(["requested", "processing"])

/**
 * 주문 목록 한 줄의 반품·교환 상태. 진행 중인 반품이 있으면 그것이 먼저다.
 * returns 는 늦게 요청한 순(Medusa 목록 순)이라고 본다. 취소한 반품은 보지 않는다.
 */
export function itemReturnStatus(itemId: string, returns: CustomerReturn[]): ItemReturnStatus | null {
  const touching = returns.filter((r) => r.stage !== "canceled" && r.items.some((i) => i.itemId === itemId))
  if (touching.length === 0) return null

  const active = touching.filter((r) => ACTIVE.has(r.stage))
  const group = active.length > 0 ? active : touching
  const latest = group[0]
  const quantity = group.reduce(
    (sum, r) => sum + r.items.filter((i) => i.itemId === itemId).reduce((s, i) => s + i.quantity, 0),
    0
  )
  const exchange = latest.kind === "exchange"
  const key: ItemReturnStatusKey =
    active.length > 0 ? (exchange ? "exchanging" : "returning") : exchange ? "exchanged" : "returned"
  return { key, quantity, returnId: latest.returnId, stage: latest.stage, refundedAt: latest.refund?.refundedAt ?? null }
}

/**
 * 반품한 줄의 처음 낸 금액. Medusa 는 받은 반품 수량을 빼고 item.total 을 다시 계산해서 다 반품하면 0원이 된다 —
 * 단가 × 주문 수량에서 그 줄 할인(adjustments, 주문 수량 전체 몫)을 뺀다.
 */
export function originalLineTotal(item: {
  unit_price?: number
  quantity?: number
  adjustments?: ReadonlyArray<{ amount: number }> | null
}): number {
  const discount = (item.adjustments ?? []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0)
  return (item.unit_price ?? 0) * (item.quantity ?? 0) - discount
}
