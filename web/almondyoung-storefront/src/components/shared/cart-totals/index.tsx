"use client"

import { formatPrice } from "@/lib/utils/price-utils"
import {
  calculateCartDiscount,
  type CartDiscountContext,
} from "domains/cart/utils/calculate-discount"
import { useTranslations } from "next-intl"
import React from "react"

type CartItem = {
  quantity: number
  unit_price: number
  compare_at_unit_price?: number | null
  variant?: { metadata?: Record<string, unknown> | null } | null
  product?: { metadata?: Record<string, unknown> | null } | null
}

type CartTotalsProps = {
  totals: {
    total?: number | null
    subtotal?: number | null
    currency_code: string
    item_subtotal?: number | null
    shipping_total?: number | null
    discount_total?: number | null
    items?: CartItem[]
  }
  /** 주면 정가 − 단가 중 수량 할인을 따로 보인다 */
  discountContext?: CartDiscountContext<CartItem>
}

const CartTotals: React.FC<CartTotalsProps> = ({ totals, discountContext }) => {
  const t = useTranslations("cart")
  const ts = useTranslations("cart.summary")

  /** 금액을 안전하게 포맷 (값이 없으면 "-" 반환) */
  const safeFormatPrice = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "-"
    return `${formatPrice(value)}${t("won")}`
  }

  const {
    total, // 최종 결제 금액
    item_subtotal, // 총 상품 가격
    shipping_total, // 배송비
    discount_total, // 할인 금액 (쿠폰/프로모션)
    items,
  } = totals

  const { membershipDiscount, quantityDiscount } = calculateCartDiscount(items, discountContext)
  // 비회원에게 남는 몫은 멤버십 할인이 아니다(타임세일 등) — 맥락이 있을 때만 이름을 가른다.
  const otherDiscountLabel =
    discountContext && !discountContext.isMember ? ts("productDiscount") : ts("membershipDiscount")

  return (
    <div>
      <div className="txt-medium text-ui-fg-subtle flex flex-col gap-y-2">
        <div className="flex items-center justify-between">
          <span>{ts("subtotal")}</span>
          <span data-testid="cart-subtotal" data-value={item_subtotal ?? ""}>
            {safeFormatPrice(item_subtotal)}
          </span>
        </div>

        {membershipDiscount > 0 && (
          <div className="flex items-center justify-between">
            <span>{otherDiscountLabel}</span>
            <span
              className="text-destructive"
              data-testid="cart-membership-discount"
              data-value={membershipDiscount}
            >
              -{formatPrice(membershipDiscount)}{t("won")}
            </span>
          </div>
        )}

        {quantityDiscount > 0 && (
          <div className="flex items-center justify-between">
            <span>{ts("quantityDiscount")}</span>
            <span
              className="text-destructive"
              data-testid="cart-quantity-discount"
              data-value={quantityDiscount}
            >
              -{formatPrice(quantityDiscount)}{t("won")}
            </span>
          </div>
        )}

        {!!discount_total && (
          <div className="flex items-center justify-between">
            <span>{ts("couponDiscount")}</span>
            <span
              className="text-destructive"
              data-testid="cart-discount"
              data-value={discount_total}
            >
              -{formatPrice(discount_total)}{t("won")}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span>{ts("shipping")}</span>
          <span data-testid="cart-shipping" data-value={shipping_total ?? ""}>
            {safeFormatPrice(shipping_total)}
          </span>
        </div>
      </div>
      <div className="my-4 h-px w-full border-b border-gray-200" />
      <div className="text-ui-fg-base txt-medium mb-2 flex items-center justify-between">
        <span>{ts("totalPayment")}</span>
        <span
          className="txt-xlarge-plus text-foreground font-bold"
          data-testid="cart-total"
          data-value={total ?? ""}
        >
          {safeFormatPrice(total)}
        </span>
      </div>
      <div className="mt-4 h-px w-full border-b border-gray-200" />
    </div>
  )
}

export default CartTotals
