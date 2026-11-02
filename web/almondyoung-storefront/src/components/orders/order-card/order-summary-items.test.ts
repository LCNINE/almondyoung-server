import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"
import type { HttpTypes } from "@medusajs/types"
import type { CustomerReturn } from "@/lib/types/ui/returns"
import mypage from "@/i18n/messages/ko/mypage.json"
import { mapOrderSummaryItems } from "./order-summary-items"
import { groupOrderItems } from "./order-status-groups"

const translate = createTranslator({
  locale: "ko",
  messages: { mypage },
  namespace: "mypage.order.list",
})
const t = (key: string, values?: Record<string, string | number>) =>
  translate(key as Parameters<typeof translate>[0], values)

const order = {
  id: "order-3065",
  items: [
    { id: "a", title: "반품 상품", quantity: 3, unit_price: 1000, total: 0 },
    { id: "b", title: "준비 상품", quantity: 1, unit_price: 2000, total: 2000 },
  ],
} as HttpTypes.StoreOrder
const ret = (overrides: Partial<CustomerReturn> = {}): CustomerReturn => ({
  returnId: "r1",
  kind: "return",
  stage: "requested",
  requestedAt: "2026-10-20T00:00:00Z",
  reason: "CHANGE_OF_MIND",
  feeBearer: "customer",
  items: [{ itemId: "a", quantity: 1 }],
  canCancel: true,
  refund: null,
  ...overrides,
})

describe("mapOrderSummaryItems", () => {
  it("keeps original returned-line prices, partial quantities and review eligibility", () => {
    const items = mapOrderSummaryItems(order, [ret()], t, { a: "/review/a" })
    const groups = groupOrderItems(items, "상품 준비 중")

    expect(groups).toHaveLength(2)
    expect(groups[0].isOrderStatus).toBe(false)
    expect(groups[1].items.map((item) => item.id)).toEqual(["b"])
    expect(items[0].price).toBe("3,000원 · 3개")
    expect(items[0].statusHint).toContain("1개")
    expect(items[0].reviewHref).toBe("/review/a")
    expect(items[1].price).toBe("2,000원 · 1개")
  })

  it("includes every return in the selected status and excludes canceled or completed returns when active", () => {
    const items = mapOrderSummaryItems(
      order,
      [
        ret(),
        ret({ returnId: "r2", stage: "processing" }),
        ret({ returnId: "old", stage: "refunded" }),
        ret({ returnId: "canceled", stage: "canceled" }),
      ],
      t
    )

    expect(items[0].returnLinks?.map((link) => link.href)).toEqual([
      "/mypage/order/returns/r1?orderId=order-3065",
      "/mypage/order/returns/r2?orderId=order-3065",
    ])
  })

  it("keeps exchange and return completion in different groups", () => {
    const items = mapOrderSummaryItems(
      order,
      [
        ret({ kind: "exchange", stage: "exchanged" }),
        ret({
          returnId: "r2",
          stage: "refunded",
          items: [{ itemId: "b", quantity: 1 }],
        }),
      ],
      t
    )
    const groups = groupOrderItems(items, "결제 완료")

    expect(groups).toHaveLength(2)
    expect(groups.every((group) => !group.isOrderStatus)).toBe(true)
    expect(items[0].returnLinks?.[0].label).toBe("교환 상세 보기")
    expect(items[1].returnLinks?.[0].label).toBe("반품 상세 보기")
  })

  it("keeps canceled returns out of status grouping", () => {
    const items = mapOrderSummaryItems(order, [ret({ stage: "canceled" })], t)

    expect(groupOrderItems(items, "상품 준비 중")).toHaveLength(1)
    expect(items[0].returnLinks).toBeUndefined()
  })
})
