import { describe, expect, it } from "vitest"
import { pickupLabelKey, returnSteps, returnedAmount } from "./return-detail-view"

const none = { pickupStatus: "none" as const, arrivedAt: null, inspectedAt: null }

describe("returnSteps", () => {
  it("접수만 됐으면 첫 단계만 끝", () => {
    expect(returnSteps({ kind: "return", stage: "requested" }, none).map((s) => s.done)).toEqual([true, false, false, false])
  })

  it("기사님이 가져가면 회수까지", () => {
    const steps = returnSteps({ kind: "return", stage: "requested" }, { ...none, pickupStatus: "picked_up" })
    expect(steps.map((s) => s.done)).toEqual([true, true, false, false])
  })

  it("Medusa processing 이면 core 진행을 못 읽어도 검수까지", () => {
    expect(returnSteps({ kind: "return", stage: "processing" }, null).map((s) => s.done)).toEqual([true, true, true, false])
  })

  it("환불이 끝나면 전부, 교환은 마지막 단계가 exchanged", () => {
    expect(returnSteps({ kind: "return", stage: "refunded" }, null).every((s) => s.done)).toBe(true)
    const ex = returnSteps({ kind: "exchange", stage: "exchanged" }, null)
    expect(ex.at(-1)).toEqual({ key: "exchanged", done: true })
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
