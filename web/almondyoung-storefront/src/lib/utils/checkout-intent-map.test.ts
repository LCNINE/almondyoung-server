import { describe, expect, it } from "vitest"
import { resolvePendingPaymentMode } from "./checkout-intent-map"

const stored = (value: Record<string, string>) => JSON.stringify(value)

describe("resolvePendingPaymentMode", () => {
  it("저장한 결제와 같은 intent 로 돌아오면 저장한 모드를 쓴다", () => {
    const raw = stored({ mode: "membership", intentId: "pi_1", planId: "plan-a" })

    expect(resolvePendingPaymentMode(raw, "pi_1")).toEqual({
      mode: "membership",
      intentId: "pi_1",
      planId: "plan-a",
    })
  })

  // #827: 멤버십 결제를 시작했다가 콜백 전에 이탈하면 값이 탭에 남는다.
  // 같은 탭의 일반 상품 결제가 그 잔재를 주워 멤버십 경로로 새면 주문이 성립하지 않는다.
  it("다른 결제의 잔재는 쓰지 않는다", () => {
    const raw = stored({ mode: "membership", intentId: "pi_old" })

    expect(resolvePendingPaymentMode(raw, "pi_new")).toBeNull()
  })

  it("intent 없이 저장된 옛 형식은 어느 결제에도 쓰지 않는다", () => {
    const raw = stored({ mode: "membership", planId: "plan-a" })

    expect(resolvePendingPaymentMode(raw, "pi_1")).toBeNull()
  })

  it("콜백 URL 에 intent 가 없으면 쓰지 않는다", () => {
    const raw = stored({ mode: "membership", intentId: "pi_1" })

    expect(resolvePendingPaymentMode(raw, null)).toBeNull()
  })

  it("비었거나 깨진 값은 없는 것으로 본다", () => {
    expect(resolvePendingPaymentMode(null, "pi_1")).toBeNull()
    expect(resolvePendingPaymentMode("{not json", "pi_1")).toBeNull()
    expect(resolvePendingPaymentMode(stored({ intentId: "pi_1" }), "pi_1")).toBeNull()
  })
})
