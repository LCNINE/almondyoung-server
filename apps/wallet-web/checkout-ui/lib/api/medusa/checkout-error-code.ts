/**
 * Medusa 가 돌려주는 영문 에러 메시지를 결제 실패 페이지가 번역할 수 있는 코드로 바꾼다.
 *
 * 실패 페이지는 `message` 쿼리를 그대로 화면에 찍는다. 매핑되지 않은 에러는 원문이 그대로
 * 노출되므로, 고객에게 보일 만한 것부터 코드로 잡는다.
 */

export const CHECKOUT_ERROR_CODES = {
  /** 카트에 담긴 배송비 그룹 중 배송수단이 빠진 게 있다. */
  shippingMethodMissing: "SHIPPING_METHOD_MISSING",
  /** 배송이 필요한 상품인데 배송수단이 하나도 없다. */
  shippingMethodNone: "SHIPPING_METHOD_NONE",
  /** 결제 도중 재고가 모자라졌다. 주문 생성 전에 막히므로 결제도 성립하지 않는다. */
  insufficientInventory: "INSUFFICIENT_INVENTORY",
  /** 담아둔 상품(또는 옵션)이 판매중단됐다. */
  variantUnavailable: "VARIANT_UNAVAILABLE",
} as const

export type CheckoutErrorCode =
  (typeof CHECKOUT_ERROR_CODES)[keyof typeof CHECKOUT_ERROR_CODES]

const PATTERNS: Array<{ test: RegExp; code: CheckoutErrorCode }> = [
  {
    test: /require shipping profiles that are not satisfied/i,
    code: CHECKOUT_ERROR_CODES.shippingMethodMissing,
  },
  {
    test: /No shipping method selected but the cart contains items that require shipping/i,
    code: CHECKOUT_ERROR_CODES.shippingMethodNone,
  },
  {
    test: /does not have the required inventory/i,
    code: CHECKOUT_ERROR_CODES.insufficientInventory,
  },
  {
    test: /do not exist or belong to a product that is not published/i,
    code: CHECKOUT_ERROR_CODES.variantUnavailable,
  },
]

/** 아는 에러면 코드를, 모르면 null 을 돌려준다. */
export function toCheckoutErrorCode(error: unknown): CheckoutErrorCode | null {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  if (!message) return null

  return PATTERNS.find((pattern) => pattern.test.test(message))?.code ?? null
}
