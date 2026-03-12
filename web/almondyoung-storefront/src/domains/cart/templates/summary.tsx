"use client"

import { Button } from "@/components/ui/button"
import { HttpTypes } from "@medusajs/types"
import CartTotals from "@/components/shared/cart-totals"
import Divider from "@/components/shared/divider"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import PriceErrorNotice from "../components/price-error-notice"

type SummaryProps = {
  cart: HttpTypes.StoreCart & {
    promotions: HttpTypes.StorePromotion[]
  }
}

function getCheckoutStep(cart: HttpTypes.StoreCart) {
  if (!cart?.shipping_address?.address_1 || !cart.email) {
    return "address"
  } else if (cart?.shipping_methods?.length === 0) {
    return "delivery"
  } else {
    return "payment"
  }
}

const Summary = ({ cart }: SummaryProps) => {
  const step = getCheckoutStep(cart)

  // 필수 금액 값이 유효한지 체크
  const isTotalValid = cart.total !== null && cart.total !== undefined
  const hasError = !isTotalValid

  return (
    <div className="flex flex-col gap-y-4">
      <h2 className="text-2xl font-semibold">주문 예상 금액</h2>

      <Divider />
      <CartTotals totals={cart} />

      {hasError && <PriceErrorNotice />}

      {hasError ? (
        <Button className="h-10 w-full" disabled>
          구매하기
        </Button>
      ) : (
        <LocalizedClientLink
          href={"/checkout?step=" + step}
          data-testid="checkout-button"
        >
          <Button className="h-10 w-full">구매하기</Button>
        </LocalizedClientLink>
      )}
    </div>
  )
}

export default Summary
