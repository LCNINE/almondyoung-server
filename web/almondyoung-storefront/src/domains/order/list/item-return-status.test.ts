import { describe, expect, it } from "vitest"
import type { CustomerReturn } from "@/lib/types/ui/returns"
import { itemReturnStatus, originalLineTotal } from "./item-return-status"

const ret = (over: Partial<CustomerReturn>): CustomerReturn => ({
  returnId: "ret_1",
  kind: "return",
  stage: "requested",
  requestedAt: "2026-10-20T00:00:00.000Z",
  reason: "defective",
  feeBearer: "seller",
  items: [{ itemId: "i1", quantity: 1 }],
  canCancel: true,
  refund: null,
  ...over,
})

describe("itemReturnStatus", () => {
  it("그 줄에 닿은 반품이 없으면 null", () => {
    expect(itemReturnStatus("i2", [ret({})])).toBeNull()
  })

  it("취소한 반품은 보지 않는다", () => {
    expect(itemReturnStatus("i1", [ret({ stage: "canceled" })])).toBeNull()
  })

  it("접수·검수 중이면 returning", () => {
    expect(itemReturnStatus("i1", [ret({ stage: "processing" })])).toMatchObject({ key: "returning", quantity: 1, returnId: "ret_1" })
  })

  it("환불이 끝났으면 returned 와 환불한 때", () => {
    const refund = { itemTotal: 1, shippingRefund: 0, fees: 0, total: 1, receivedAt: null, refundedAt: "2026-10-22T00:00:00.000Z" }
    expect(itemReturnStatus("i1", [ret({ stage: "refunded", refund })])).toMatchObject({
      key: "returned",
      refundedAt: "2026-10-22T00:00:00.000Z",
    })
  })

  it("끝난 반품과 진행 중인 반품이 같이 있으면 진행 중이 먼저, 수량은 진행 중인 것만", () => {
    const out = itemReturnStatus("i1", [
      ret({ returnId: "new", stage: "requested", items: [{ itemId: "i1", quantity: 1 }] }),
      ret({ returnId: "old", stage: "refunded", items: [{ itemId: "i1", quantity: 2 }] }),
    ])
    expect(out).toMatchObject({ key: "returning", quantity: 1, returnId: "new" })
  })

  it("끝난 반품이 여럿이면 수량을 더하고 가장 최근 반품으로 간다", () => {
    const out = itemReturnStatus("i1", [
      ret({ returnId: "b", stage: "refunded" }),
      ret({ returnId: "a", stage: "refunded" }),
    ])
    expect(out).toMatchObject({ key: "returned", quantity: 2, returnId: "b" })
  })

  it("교환은 exchanging·exchanged", () => {
    expect(itemReturnStatus("i1", [ret({ kind: "exchange" })])?.key).toBe("exchanging")
    expect(itemReturnStatus("i1", [ret({ kind: "exchange", stage: "exchanged" })])?.key).toBe("exchanged")
  })
})

describe("originalLineTotal", () => {
  it("단가 × 수량에서 줄 할인을 뺀다 — 반품으로 줄어든 item.total 과 무관하다", () => {
    expect(originalLineTotal({ unit_price: 14800, quantity: 2, adjustments: [{ amount: 1800 }] })).toBe(27800)
  })

  it("할인이 없으면 단가 × 수량", () => {
    expect(originalLineTotal({ unit_price: 9000, quantity: 1, adjustments: undefined })).toBe(9000)
  })
})
