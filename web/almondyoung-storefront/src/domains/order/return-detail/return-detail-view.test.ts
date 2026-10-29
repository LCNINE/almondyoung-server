import { describe, expect, it } from "vitest"
import { pickupLabelKey, returnSteps, returnedAmount } from "./return-detail-view"

const none = { pickupStatus: "none" as const, arrivedAt: null, inspectedAt: null }

describe("returnSteps", () => {
  it("접수만 됐으면 첫 단계만 끝", () => {
    expect(returnSteps({ kind: "return", stage: "requested", refund: null }, none).map((s) => s.done)).toEqual([true, false, false, false])
  })

  it("기사님이 가져가면 회수까지", () => {
    const steps = returnSteps({ kind: "return", stage: "requested", refund: null }, { ...none, pickupStatus: "picked_up" })
    expect(steps.map((s) => s.done)).toEqual([true, true, false, false])
  })

  it("Medusa processing 이면 core 진행을 못 읽어도 검수까지", () => {
    expect(returnSteps({ kind: "return", stage: "processing", refund: null }, null).map((s) => s.done)).toEqual([true, true, true, false])
  })

  it("환불이 끝나면 전부, 교환은 마지막 단계가 exchanged", () => {
    expect(returnSteps({ kind: "return", stage: "refunded", refund: null }, null).every((s) => s.done)).toBe(true)
    const ex = returnSteps({ kind: "exchange", stage: "exchanged", refund: null }, null)
    expect(ex.at(-1)).toEqual({ key: "exchanged", done: true })
  })
})

describe("returnSteps — 선환불", () => {
  const prepaid = { kind: "prepaid" as const, itemTotal: 60000, shippingRefund: 0, fees: 0, total: 10000, receivedAt: null, refundedAt: "2026-10-27T00:00:00.000Z" }

  it("선환불만 끝났으면 환불 단계만 끝 — 회수·검수는 아직", () => {
    const steps = returnSteps({ kind: "return", stage: "refunded", refund: prepaid }, { ...none, pickupStatus: "requested" })
    expect(steps.map((s) => s.done)).toEqual([true, false, false, true])
  })

  it("선환불 뒤 창고가 받았으면 회수·검수도 끝", () => {
    const steps = returnSteps(
      { kind: "return", stage: "refunded", refund: prepaid },
      { ...none, arrivedAt: "2026-10-28T00:00:00.000Z", inspectedAt: "2026-10-28T01:00:00.000Z" }
    )
    expect(steps.every((s) => s.done)).toBe(true)
  })
})

describe("returnedAmount", () => {
  it("줄 금액을 반품 수량만큼 나눈다", () => {
    expect(returnedAmount(30000, 3, 1)).toBe(10000)
  })

  it("수량 0 인 줄은 0", () => {
    expect(returnedAmount(30000, 0, 1)).toBe(0)
  })
})

describe("pickupLabelKey", () => {
  it("창고에 도착했으면 회수 행이 없어도 회수 완료", () => {
    expect(pickupLabelKey({ pickupStatus: "none", arrivedAt: "2026-10-21T00:00:00.000Z" })).toBe("pickedUp")
  })

  it("접수된 회수는 requested, 아무것도 없으면 none", () => {
    expect(pickupLabelKey({ pickupStatus: "requested", arrivedAt: null })).toBe("requested")
    expect(pickupLabelKey({ pickupStatus: "none", arrivedAt: null })).toBe("none")
  })
})
