import { describe, expect, it } from "vitest"
import { resolveOrderAccess } from "./resolve-order-access"

const customer = (metadata?: Record<string, unknown> | null) => ({
  id: "cus_1",
  metadata,
})

describe("주문 소유권과 만족도 카드 노출", () => {
  it("고객 ID 가 같고 almond_user_id 가 있으면 둘 다 허용한다", () => {
    expect(
      resolveOrderAccess({ customer_id: "cus_1" }, customer({ almond_user_id: "u1" }))
    ).toEqual({ isCustomerMatch: true, canShowSatisfaction: true })
  })

  it("고객 ID 가 같아도 almond_user_id 가 없거나 비면 카드는 숨긴다", () => {
    for (const metadata of [undefined, null, {}, { almond_user_id: "" }, { almond_user_id: "  " }]) {
      expect(
        resolveOrderAccess({ customer_id: "cus_1" }, customer(metadata))
      ).toEqual({ isCustomerMatch: true, canShowSatisfaction: false })
    }
  })

  it("고객 ID 가 다르면 almond_user_id 가 있어도 거부한다", () => {
    expect(
      resolveOrderAccess({ customer_id: "cus_2" }, customer({ almond_user_id: "u1" }))
    ).toEqual({ isCustomerMatch: false, canShowSatisfaction: false })
  })

  it("주문 customer_id 가 비었거나 비로그인이면 거부한다", () => {
    expect(resolveOrderAccess({ customer_id: null }, customer({ almond_user_id: "u1" })).isCustomerMatch).toBe(false)
    expect(resolveOrderAccess({ customer_id: "cus_1" }, null).isCustomerMatch).toBe(false)
    expect(resolveOrderAccess(null, customer()).isCustomerMatch).toBe(false)
  })
})
