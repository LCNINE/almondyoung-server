import { describe, expect, it } from "vitest"
import type { CustomerReturn } from "@/lib/types/ui/returns"
import { getCompletedOrderReturnStatus } from "./order-status-display"

const items = [
  { id: "i1", quantity: 2 },
  { id: "i2", quantity: 1 },
]

function returned(overrides: Partial<CustomerReturn> = {}): CustomerReturn {
  return {
    returnId: "ret_1",
    kind: "return",
    stage: "refunded",
    requestedAt: "2026-10-20T00:00:00.000Z",
    reason: "CHANGE_OF_MIND",
    feeBearer: "customer",
    items: [
      { itemId: "i1", quantity: 2 },
      { itemId: "i2", quantity: 1 },
    ],
    canCancel: false,
    refund: null,
    ...overrides,
  }
}

describe("getCompletedOrderReturnStatus", () => {
  it("모든 줄의 수량이 환불됐으면 반품완료다", () => {
    expect(getCompletedOrderReturnStatus(items, [returned()])).toBe("returned")
  })

  it("모든 줄의 수량이 교환됐으면 교환완료다", () => {
    expect(
      getCompletedOrderReturnStatus(items, [
        returned({ kind: "exchange", stage: "exchanged" }),
      ])
    ).toBe("exchanged")
  })

  it("여러 번 완료한 반품 수량을 줄별로 합한다", () => {
    const returns = [
      returned({ items: [{ itemId: "i1", quantity: 1 }] }),
      returned({
        returnId: "ret_2",
        items: [
          { itemId: "i1", quantity: 1 },
          { itemId: "i2", quantity: 1 },
        ],
      }),
    ]

    expect(getCompletedOrderReturnStatus(items, returns)).toBe("returned")
  })

  it.each([
    [
      { itemId: "i1", quantity: 1 },
      { itemId: "i2", quantity: 1 },
    ],
    [{ itemId: "i1", quantity: 3 }],
    [{ itemId: "other", quantity: 3 }],
  ])(
    "일부 수량이나 일부 줄만 환불했으면 배송 상태를 유지한다: %j",
    (...returnItems) => {
      expect(
        getCompletedOrderReturnStatus(items, [returned({ items: returnItems })])
      ).toBeNull()
    }
  )

  it.each(["requested", "processing", "canceled"] as const)(
    "%s 반품은 완료 수량에 넣지 않는다",
    (stage) => {
      expect(
        getCompletedOrderReturnStatus(items, [returned({ stage })])
      ).toBeNull()
    }
  )

  it("완료 수량에 진행 중인 수량을 더하지 않는다", () => {
    const returns = [
      returned({ stage: "processing", items: [{ itemId: "i1", quantity: 1 }] }),
      returned({
        items: [
          { itemId: "i1", quantity: 1 },
          { itemId: "i2", quantity: 1 },
        ],
      }),
    ]

    expect(getCompletedOrderReturnStatus(items, returns)).toBeNull()
  })

  it("회수 전 선환불은 완료로 보지 않는다", () => {
    const refund: CustomerReturn["refund"] = {
      kind: "prepaid",
      itemTotal: 1000,
      shippingRefund: 0,
      fees: 0,
      total: 1000,
      receivedAt: null,
      refundedAt: "2026-10-21T00:00:00.000Z",
    }

    expect(
      getCompletedOrderReturnStatus(items, [returned({ refund })])
    ).toBeNull()
  })

  it("반품과 교환으로 서로 다른 줄이 완료돼도 한 종류의 완료로 표시하지 않는다", () => {
    const returns = [
      returned({ items: [{ itemId: "i1", quantity: 2 }] }),
      returned({
        kind: "exchange",
        stage: "exchanged",
        items: [{ itemId: "i2", quantity: 1 }],
      }),
    ]

    expect(getCompletedOrderReturnStatus(items, returns)).toBeNull()
  })

  it("같은 줄의 반품과 교환 수량을 합하지 않는다", () => {
    const returns = [
      returned({ items: [{ itemId: "i1", quantity: 1 }] }),
      returned({
        kind: "exchange",
        stage: "exchanged",
        items: [{ itemId: "i1", quantity: 1 }],
      }),
    ]

    expect(getCompletedOrderReturnStatus([items[0]], returns)).toBeNull()
  })

  it("주문 줄이나 반품 데이터가 없으면 배송 상태를 유지한다", () => {
    expect(getCompletedOrderReturnStatus([], [returned()])).toBeNull()
    expect(getCompletedOrderReturnStatus(undefined, [returned()])).toBeNull()
    expect(getCompletedOrderReturnStatus(items, null)).toBeNull()
    expect(getCompletedOrderReturnStatus(items, [])).toBeNull()
  })
})
