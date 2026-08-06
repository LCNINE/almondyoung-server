import { describe, expect, it } from "vitest"

import { CHECKOUT_ERROR_CODES, toCheckoutErrorCode } from "./checkout-error-code"

describe("toCheckoutErrorCode", () => {
  it("배송비 그룹이 덜 붙은 에러를 잡는다", () => {
    const raw =
      "The cart items require shipping profiles that are not satisfied by the current shipping methods"
    expect(toCheckoutErrorCode(new Error(raw))).toBe(
      CHECKOUT_ERROR_CODES.shippingMethodMissing
    )
    expect(toCheckoutErrorCode(raw)).toBe(CHECKOUT_ERROR_CODES.shippingMethodMissing)
  })

  it("배송수단이 아예 없는 에러를 잡는다", () => {
    expect(
      toCheckoutErrorCode(
        new Error(
          "No shipping method selected but the cart contains items that require shipping."
        )
      )
    ).toBe(CHECKOUT_ERROR_CODES.shippingMethodNone)
  })

  // 매핑 안 된 에러는 기존처럼 원문이 노출된다. 잘못 뭉뚱그리면 원인을 못 찾는다.
  it("모르는 에러는 null", () => {
    expect(toCheckoutErrorCode(new Error("Insufficient inventory"))).toBeNull()
    expect(toCheckoutErrorCode(null)).toBeNull()
    expect(toCheckoutErrorCode("")).toBeNull()
  })
})
