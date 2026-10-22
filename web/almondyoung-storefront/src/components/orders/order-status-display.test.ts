import { describe, expect, it } from "vitest"
import type {
  StoreFulfillmentStatus,
  StoreOrderActionsResponse,
} from "@/lib/api/orders/store-orders"
import { getCoreDisplayStatus, orderBadgeStatus } from "./order-status-display"

function actions(over: Partial<StoreOrderActionsResponse> = {}): StoreOrderActionsResponse {
  return {
    orderId: "so-1",
    channelOrderId: "order_1",
    orderStatus: "pending",
    fulfillmentStatus: "not_created",
    refundStatus: "none",
    claimStatus: "none",
    availableActions: [],
    ...over,
  }
}

describe("getCoreDisplayStatus — 진행 단계가 core 값을 따른다 (K6 PR5 · D8)", () => {
  it.each([
    // [orderStatus, fulfillmentStatus, paymentStatus, 기대 문구]
    ["pending", "preparing", "paid", "상품 준비 중"], // D8: 전엔 «결제 완료»
    ["pending", "shipping", "paid", "배송 중"], // D8: 전엔 «결제 완료»
    ["pending", "delivered", "paid", "배송 완료"],
    ["pending", "not_created", "paid", "결제 완료"],
    ["pending", "not_created", "awaiting_payment", "입금 대기"],
    ["pending", "not_created", undefined, "결제 완료"],
    ["confirmed", "preparing", "paid", "상품 준비 중"],
    ["processing", "preparing", "paid", "상품 준비 중"],
    ["shipped", "shipping", "paid", "배송 중"], // 셀메이트 출고 — 바뀌지 않는다
    ["shipped", "delivered", "paid", "배송 완료"], // 셀메이트 출고 — 바뀌지 않는다
    ["cancelled", "canceled", "paid", "취소됨"],
    ["confirmed", "canceled", "paid", "결제 완료"], // FO 만 취소 — 현행 유지
  ] as const)("%s · %s · %s → %s", (orderStatus, fulfillmentStatus, paymentStatus, expected) => {
    expect(getCoreDisplayStatus(actions({ orderStatus, fulfillmentStatus, paymentStatus }))).toBe(expected)
  })

  it("core 가 먼저 늘린 모르는 단계는 SO 라벨로 내려간다(예외 없음)", () => {
    // core 가 스토어프론트보다 먼저 값을 늘리는 경우를 흉내 낸다(같은 SST 스택이라 배포 순서가 없다)
    const unknown = "returning" as unknown as StoreFulfillmentStatus
    expect(getCoreDisplayStatus(actions({ orderStatus: "pending", fulfillmentStatus: unknown }))).toBe("결제 완료")
  })
})

describe("orderBadgeStatus — 주문 상태 뱃지와 진행 단계 뱃지가 겹치지 않는다 (K6 PR5)", () => {
  it.each(["shipped", "delivered"])("SO %s(셀메이트 출고)는 주문 상태 뱃지를 그리지 않는다 — 단계 뱃지가 그 사실을 담는다", (orderStatus) => {
    expect(orderBadgeStatus(actions({ orderStatus, fulfillmentStatus: "shipping" }))).toBeNull()
  })
  it.each(["pending", "confirmed", "processing", "cancelled", "timeout"])("SO %s 는 그대로", (orderStatus) => {
    expect(orderBadgeStatus(actions({ orderStatus, fulfillmentStatus: "preparing" }))).toBe(orderStatus)
  })
})
