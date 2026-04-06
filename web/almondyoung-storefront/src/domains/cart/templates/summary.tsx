"use client"

import { Button } from "@/components/ui/button"
import { HttpTypes } from "@medusajs/types"
import CartTotals from "@/components/shared/cart-totals"
import Divider from "@/components/shared/divider"
import { Loader2 } from "lucide-react"

import PriceErrorNotice from "../components/price-error-notice"

type SummaryProps = {
  cart: HttpTypes.StoreCart & {
    promotions: HttpTypes.StorePromotion[]
  }
  selectedCount: number
  onCheckout: () => void
  isPendingCheckout: boolean
}

export default function Summary({
  cart,
  selectedCount,
  onCheckout,
  isPendingCheckout,
}: SummaryProps) {
  // 필수 금액 값이 유효한지 체크
  const isTotalValid = cart.total !== null && cart.total !== undefined
  const hasError = !isTotalValid

  const isDisabled = hasError || selectedCount === 0 || isPendingCheckout

  return (
    <div className="flex flex-col gap-y-4">
      <h2 className="text-2xl font-semibold">주문 예상 금액</h2>

      <Divider />
      <CartTotals totals={cart} />

      {hasError && <PriceErrorNotice />}

      {selectedCount === 0 && !hasError && (
        <p className="text-sm text-muted-foreground">
          구매할 상품을 선택해주세요.
        </p>
      )}

      <Button
        className="h-10 w-full"
        disabled={isDisabled}
        onClick={onCheckout}
        data-testid="checkout-button"
      >
        {isPendingCheckout && (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        )}
        {selectedCount > 0 ? `${selectedCount}개 상품 구매하기` : "구매하기"}
      </Button>
    </div>
  )
}
