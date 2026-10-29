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

/**
 * 아직 끝나지 않은 반품. 선환불만 하고 물건이 아직 안 온 반품은 Medusa 단계가 refunded 여도 진행 중이다.
 */
export function isReturnInProgress(r: Pick<CustomerReturn, "stage" | "refund">): boolean {
  if (r.stage === "requested" || r.stage === "processing") return true
  return r.stage === "refunded" && r.refund?.kind === "prepaid" && !r.refund.receivedAt
}

/**
 * 주문 목록 한 줄의 반품·교환 상태. 진행 중인 반품이 있으면 그것이 먼저다.
 * returns 는 늦게 요청한 순(Medusa 목록 순)이라고 본다. 취소한 반품은 보지 않는다.
 * 한 줄에 반품과 교환이 섞이면 고른 쪽(가장 최근)과 같은 종류의 수량만 센다 — 나머지는 일부 수량으로 보인다.
 */
export function itemReturnStatus(itemId: string, returns: CustomerReturn[]): ItemReturnStatus | null {
  const touching = returns.filter((r) => r.stage !== "canceled" && r.items.some((i) => i.itemId === itemId))
  if (touching.length === 0) return null

  const active = touching.filter(isReturnInProgress)
  const latest = (active.length > 0 ? active : touching)[0]
  const group = (active.length > 0 ? active : touching).filter((r) => r.kind === latest.kind)
  const quantity = group.reduce(
    (sum, r) => sum + r.items.filter((i) => i.itemId === itemId).reduce((s, i) => s + i.quantity, 0),
    0
  )
  const exchange = latest.kind === "exchange"
  const key: ItemReturnStatusKey =
    active.length > 0 ? (exchange ? "exchanging" : "returning") : exchange ? "exchanged" : "returned"
  return {
    key,
    quantity,
    returnId: latest.returnId,
    stage: latest.stage,
    refundedAt: active.length > 0 ? null : latest.refund?.refundedAt ?? null,
  }
}

/**
 * 반품한 줄의 처음 낸 금액. Medusa 는 받은 반품 수량을 빼고 item.total 을 다시 계산해서 다 반품하면 0원이 된다 —
 * 같은 식을 주문 수량 전체로 다시 푼다(@medusajs/utils line-item·adjustment totals):
 * (단가 × 수량 세전 − 할인 세전 합) × (1 + 세율). 가격·할인마다 세금 포함 여부를 따로 본다.
 */
export function originalLineTotal(item: {
  unit_price?: number
  quantity?: number
  is_tax_inclusive?: boolean
  adjustments?: ReadonlyArray<{ amount: number; is_tax_inclusive?: boolean }> | null
  tax_lines?: ReadonlyArray<{ rate: number }> | null
}): number {
  const rate = (item.tax_lines ?? []).reduce((sum, t) => sum + (Number(t.rate) || 0), 0) / 100
  const preTax = (amount: number, inclusive: boolean | undefined) => (inclusive ? amount / (1 + rate) : amount)
  // 세금 포함 여부가 비어 있으면 포함으로 본다 — 원화 가격은 세금 포함이다
  const subtotal = preTax((item.unit_price ?? 0) * (item.quantity ?? 0), item.is_tax_inclusive !== false)
  const discount = (item.adjustments ?? []).reduce(
    (sum, a) => sum + preTax(Number(a.amount) || 0, a.is_tax_inclusive),
    0
  )
  return Math.round((subtotal - discount) * (1 + rate))
}
