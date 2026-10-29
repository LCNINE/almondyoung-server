import { describe, expect, it } from "vitest"
import type { CustomerReturn } from "@/lib/types/ui/returns"
import { reasonLabelKey } from "../return-request/return-reasons"
import { cancelRejectKey, returnItemRows, returnKindKey, returnStageKey } from "./order-returns-view"

const ret = (items: CustomerReturn["items"]): CustomerReturn => ({
  returnId: "r1",
  kind: "return",
  stage: "requested",
  requestedAt: "2026-10-28T00:00:00Z",
  reason: "other",
  feeBearer: "customer",
  items,
  canCancel: true,
})

describe("order-returns-view", () => {
  it("단계마다 문구 키", () => {
    expect(returnStageKey("requested", "return")).toBe("stage.requested")
    expect(returnStageKey("processing", "return")).toBe("stage.processing")
    expect(returnStageKey("refunded", "return")).toBe("stage.refunded")
    expect(returnStageKey("canceled", "return")).toBe("stage.canceled")
  })

  it("교환 단계는 exchangeStage.<stage> — 교환 문구가 없는 refunded 는 반품 문구, exchanged 는 종류와 무관하게 교환 문구", () => {
    expect(returnStageKey("requested", "exchange")).toBe("exchangeStage.requested")
    expect(returnStageKey("processing", "exchange")).toBe("exchangeStage.processing")
    expect(returnStageKey("exchanged", "exchange")).toBe("exchangeStage.exchanged")
    expect(returnStageKey("canceled", "exchange")).toBe("exchangeStage.canceled")
    expect(returnStageKey("refunded", "exchange")).toBe("stage.refunded")
    expect(returnStageKey("exchanged", "return")).toBe("exchangeStage.exchanged")
  })

  it("종류 표지 키", () => {
    expect(returnKindKey("return")).toBe("kind.return")
    expect(returnKindKey("exchange")).toBe("kind.exchange")
  })

  it("품목 줄은 주문 품목 이름·옵션과 반품 수량", () => {
    const rows = returnItemRows(ret([{ itemId: "a", quantity: 2 }, { itemId: "zz", quantity: 1 }]), [
      { id: "a", title: "A", variantTitle: "옵션" },
    ])
    expect(rows).toEqual([
      { title: "A", variantTitle: "옵션", quantity: 2 },
      { title: "", variantTitle: null, quantity: 1 },
    ])
  })

  it("사유 other 도 이름 키가 있다", () => {
    expect(reasonLabelKey("other")).toBe("reason.other")
  })

  it("취소 거절 문구 — 도착·환불 시작은 취소 전용, 모르는 이유는 취소 실패 일반 문구", () => {
    expect(cancelRejectKey("return_arrived")).toBe("cancelReject.returnArrived")
    expect(cancelRejectKey("return_prepaid")).toBe("cancelReject.returnPrepaid")
    expect(cancelRejectKey("return_picked_up")).toBe("cancelReject.returnPickedUp")
    expect(cancelRejectKey("return_already_received")).toBe("cancelReject.returnArrived")
    expect(cancelRejectKey("not_our_return")).toBe("cancelReject.notOurReturn")
    expect(cancelRejectKey("exchange_released")).toBe("cancelReject.exchangeReleased")
    expect(cancelRejectKey("whatever")).toBe("cancelFailed")
  })
})
