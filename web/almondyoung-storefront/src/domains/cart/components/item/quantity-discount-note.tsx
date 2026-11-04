"use client"

import { useQuantityDiscountNow } from "@/hooks/use-quantity-discount-now"
import { useTranslations } from "next-intl"
import type { HttpTypes } from "@medusajs/types"
import { useCart } from "@/contexts/cart-context"
import { useTimeSaleForLine } from "@/components/providers/time-sale-provider"
import { formatPrice } from "@/lib/utils/price-utils"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { cartLineTierInfo } from "@/lib/utils/quantity-discount"

type QuantityDiscountNoteProps = {
  item: HttpTypes.StoreCartLineItem
  /** 다음 구간까지 수량을 올린다(재고 상한 검사는 호출 쪽 changeQuantity 가 한다) */
  onChangeQuantity?: (quantity: number) => boolean
  disabled?: boolean
  className?: string
}

/** 장바구니 라인의 «수량 할인 −○원»과 «N개 더 담으면 개당 X원» 안내. */
export function QuantityDiscountNote({ item, onChangeQuantity, disabled, className }: QuantityDiscountNoteProps) {
  const t = useTranslations("cart.items")
  const { cart } = useCart()
  const lineSale = useTimeSaleForLine(item)
  const now = useQuantityDiscountNow([item.product?.metadata])

  const { quantityDiscount, next } = cartLineTierInfo(item, {
    isMember: isMembershipGroup(cart?.customer?.groups),
    isTimeSale: lineSale !== null,
    now,
  })
  if (quantityDiscount <= 0 && !next) return null

  return (
    <div className={className}>
      {quantityDiscount > 0 && (
        <p className="text-destructive text-xs font-medium" data-testid="line-quantity-discount">
          {t("quantityDiscount", { amount: formatPrice(quantityDiscount) })}
        </p>
      )}
      {next && onChangeQuantity && (
        <button
          type="button"
          disabled={disabled}
          className="text-muted-foreground text-left text-xs underline-offset-2 hover:underline disabled:opacity-50"
          onClick={() => onChangeQuantity(item.quantity + next.addQuantity)}
          data-testid="line-quantity-nudge"
        >
          {t("quantityNudge", {
            count: next.addQuantity,
            amount: formatPrice(next.unitPrice),
            percent: next.percent,
          })}{" "}
          <span className="text-foreground font-medium">
            {t("quantityNudgeAction", { count: next.addQuantity })}
          </span>
        </button>
      )}
    </div>
  )
}
