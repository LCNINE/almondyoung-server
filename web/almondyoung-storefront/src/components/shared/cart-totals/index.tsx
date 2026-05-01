"use client"

import { formatPrice } from "@/lib/utils/price-utils"
import { calculateCartDiscount } from "domains/cart/utils/calculate-discount"
import React from "react"

type CartItem = {
  quantity: number
  unit_price: number
  compare_at_unit_price?: number | null
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
}

/** 금액을 안전하게 포맷 (값이 없으면 "-" 반환) */
const safeFormatPrice = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "-"
  return `${formatPrice(value)}원`
}

const CartTotals: React.FC<CartTotalsProps> = ({ totals }) => {
  const {
    total, // 최종 결제 금액
    item_subtotal, // 총 상품 가격
    shipping_total, // 배송비
    discount_total, // 할인 금액 (쿠폰/프로모션)
    items,
  } = totals

  const { membershipDiscount } = calculateCartDiscount(items)

  return (
    <div>
      <div className="txt-medium text-ui-fg-subtle flex flex-col gap-y-2">
        <div className="flex items-center justify-between">
          <span>총 상품 가격</span>
          <span data-testid="cart-subtotal" data-value={item_subtotal ?? ""}>
            {safeFormatPrice(item_subtotal)}
          </span>
        </div>

        {membershipDiscount > 0 && (
          <div className="flex items-center justify-between">
            <span>멤버십 할인</span>
            <span
              className="text-destructive"
              data-testid="cart-membership-discount"
              data-value={membershipDiscount}
            >
              -{formatPrice(membershipDiscount)}원
            </span>
          </div>
        )}

        {!!discount_total && (
          <div className="flex items-center justify-between">
            <span>쿠폰/프로모션 할인</span>
            <span
              className="text-destructive"
              data-testid="cart-discount"
              data-value={discount_total}
            >
              -{formatPrice(discount_total)}원
            </span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span>배송비</span>
          <span data-testid="cart-shipping" data-value={shipping_total ?? ""}>
            {safeFormatPrice(shipping_total)}
          </span>
        </div>
      </div>
      <div className="my-4 h-px w-full border-b border-gray-200" />
      <div className="text-ui-fg-base txt-medium mb-2 flex items-center justify-between">
        <span>총 결제 금액</span>
        <span
          className="txt-xlarge-plus"
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
