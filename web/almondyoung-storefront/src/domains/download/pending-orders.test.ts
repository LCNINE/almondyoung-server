import { describe, expect, it } from "vitest"
import { getPaidDigitalOrders, getPendingDigitalOrders } from "./pending-orders"

const order = (overrides = {}) => ({
  id: "order_1",
  display_id: 5452,
  status: "pending",
  payment_status: "captured",
  created_at: "2026-10-15T03:50:38Z",
  metadata: {},
  items: [{ id: "item_1", title: "캔바 템플릿", requires_shipping: false }],
  ...overrides,
})

describe("자료실 결제 반영 대기", () => {
  it("권한이 아직 없는 결제 완료 디지털 주문을 표시한다", () => {
    const paid = getPaidDigitalOrders([order()])
    expect(getPendingDigitalOrders(paid, [])).toEqual(paid)
    expect(paid[0].items[0].title).toBe("캔바 템플릿")
  })

  it("권한 반영을 확인한 주문만 제거한다", () => {
    const paid = getPaidDigitalOrders([order(), order({ id: "order_2" })])
    expect(
      getPendingDigitalOrders(paid, ["order_1"]).map((item) => item.id)
    ).toEqual(["order_2"])
    expect(getPendingDigitalOrders(paid, ["order_1", "order_2"])).toEqual([])
  })

  it.each([
    "awaiting",
    "authorized",
    "not_paid",
    "refunded",
    "partially_refunded",
    "canceled",
  ])("결제 상태 %s 는 반영 대기로 안내하지 않는다", (payment_status) => {
    expect(getPaidDigitalOrders([order({ payment_status })])).toEqual([])
  })

  it("취소 주문과 환불 신청 주문은 제외한다", () => {
    expect(
      getPaidDigitalOrders([
        order({ status: "canceled" }),
        order({ metadata: { refund_status: "requested" } }),
      ])
    ).toEqual([])
  })

  it("실물만 있거나 배송 여부가 불명확한 주문은 제외한다", () => {
    expect(
      getPaidDigitalOrders([
        order({
          items: [{ id: "physical", title: "실물", requires_shipping: true }],
        }),
        order({ items: [{ id: "unknown", title: "알 수 없음" }] }),
      ])
    ).toEqual([])
  })

  it("혼합 주문에서는 디지털 상품만 표시하고 기존 타입 판별도 지원한다", () => {
    const paid = getPaidDigitalOrders([
      order({
        items: [
          { id: "physical", title: "실물", requires_shipping: true },
          { id: "digital", title: "전자책", product_type: "digital_sale" },
        ],
      }),
    ])
    expect(paid[0].items.map((item) => item.id)).toEqual(["digital"])
  })

  it("입금 확인 후 awaiting marker 가 남아 있어도 captured 면 표시한다", () => {
    expect(
      getPaidDigitalOrders([
        order({ metadata: { bank_transfer_status: "awaiting_deposit" } }),
      ])
    ).toHaveLength(1)
  })

  it("오래 걸려도 시간 경과만으로 미반영 안내를 제거하지 않는다", () => {
    const paid = getPaidDigitalOrders([
      order({ created_at: "2026-01-01T00:00:00Z" }),
    ])
    expect(getPendingDigitalOrders(paid, [])).toHaveLength(1)
  })
})
