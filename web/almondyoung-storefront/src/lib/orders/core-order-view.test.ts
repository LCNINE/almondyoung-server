import { describe, expect, it } from "vitest"
import type { StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"
import { canConfirmPurchase, isCancelledByCore, paymentStatusForDisplay, showTrackLink } from "./core-order-view"

function actions(over: Partial<StoreOrderActionsResponse> = {}): StoreOrderActionsResponse {
  return {
    orderId: "so-1",
    channelOrderId: "order_1",
    orderStatus: "confirmed",
    fulfillmentStatus: "not_created",
    refundStatus: "none",
    claimStatus: "none",
    availableActions: [],
    ...over,
  }
}

describe("isCancelledByCore — core 는 요청 순간 취소를 확정한다(#1016 36번 재설계)", () => {
  it("cancelled 만 참, actions 가 없으면 거짓", () => {
    expect(isCancelledByCore(actions({ orderStatus: "cancelled" }))).toBe(true)
    expect(isCancelledByCore(actions())).toBe(false)
    expect(isCancelledByCore(null)).toBe(false)
    expect(isCancelledByCore(undefined)).toBe(false)
  })
})

describe("paymentStatusForDisplay — «결제 상태» 줄", () => {
  it("actions 가 없으면 Medusa 값 그대로", () => {
    expect(paymentStatusForDisplay("captured", undefined)).toBe("captured")
  })
  it("core 가 취소 안 했으면 Medusa 값 그대로", () => {
    expect(paymentStatusForDisplay("captured", actions())).toBe("captured")
  })
  it("core 취소 + 환불 완료 → refunded", () => {
    expect(paymentStatusForDisplay("captured", actions({ orderStatus: "cancelled", refundStatus: "succeeded" }))).toBe("refunded")
  })
  it.each(["pending", "delayed", "transfer_pending", "none"])("core 취소 + 환불 %s → canceled", (refundStatus) => {
    expect(paymentStatusForDisplay("captured", actions({ orderStatus: "cancelled", refundStatus }))).toBe("canceled")
  })
  it("refundSummary.status 가 refundStatus 보다 앞선다(상세와 같은 규칙)", () => {
    expect(
      paymentStatusForDisplay(
        "captured",
        actions({
          orderStatus: "cancelled",
          refundStatus: "pending",
          refundSummary: { status: "succeeded", amount: 1000, currency: "KRW", paymentMethodLabel: null, manualRequired: false, expectedProcessingMessage: null, lastUpdatedAt: null },
        })
      )
    ).toBe("refunded")
  })
})

describe("canConfirmPurchase — «구매확정» 버튼", () => {
  const base = { paymentStatus: "authorized", isConfirmed: false, awaitingDeposit: false }
  it("지금 조건 그대로 + actions 없음", () => {
    expect(canConfirmPurchase({ ...base, actions: undefined })).toBe(true)
    expect(canConfirmPurchase({ ...base, paymentStatus: "captured", actions: undefined })).toBe(false)
    expect(canConfirmPurchase({ ...base, isConfirmed: true, actions: undefined })).toBe(false)
    expect(canConfirmPurchase({ ...base, awaitingDeposit: true, actions: undefined })).toBe(false)
  })
  it("core 취소면 숨긴다", () => {
    expect(canConfirmPurchase({ ...base, actions: actions({ orderStatus: "cancelled" }) })).toBe(false)
  })
})

describe("showTrackLink — «배송 조회»", () => {
  it("배송이 필요 없으면 숨김", () => {
    expect(showTrackLink({ requiresShipping: false, canTrack: true, medusaFulfillmentStatus: "shipped", actions: undefined })).toBe(false)
  })
  it("core 가 track 을 주면 보인다", () => {
    expect(showTrackLink({ requiresShipping: true, canTrack: true, medusaFulfillmentStatus: "not_fulfilled", actions: actions() })).toBe(true)
  })
  it.each(["shipped", "fulfilled", "partially_fulfilled"])("actions 가 없으면 Medusa %s 로 보인다(지금과 같다)", (s) => {
    expect(showTrackLink({ requiresShipping: true, canTrack: false, medusaFulfillmentStatus: s, actions: undefined })).toBe(true)
  })
  it("core 취소면 Medusa 이행만으로는 보이지 않는다", () => {
    expect(
      showTrackLink({ requiresShipping: true, canTrack: false, medusaFulfillmentStatus: "shipped", actions: actions({ orderStatus: "cancelled" }) })
    ).toBe(false)
  })
})
