"use client"

import {
  getCheckoutCartByIntent,
  removeCheckoutCartByIntent,
} from "@lib/util/checkout-intent-map"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { processPaymentCallback } from "./actions"

export default function CheckoutCallbackPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()

  const countryCode = params.countryCode as string

  useEffect(() => {
    const paymentIntentId = searchParams.get("payment_intent_id")
    const status = searchParams.get("status")
    const cartId =
      searchParams.get("cartId") ||
      (paymentIntentId ? getCheckoutCartByIntent(paymentIntentId) : null)

    if (!paymentIntentId) {
      router.replace(
        `/${countryCode}/checkout/fail?code=MISSING_PAYMENT&message=${encodeURIComponent(
          "Payment intent information is missing."
        )}`
      )
      return
    }

    if (status !== "succeeded") {
      removeCheckoutCartByIntent(paymentIntentId)

      router.replace(
        `/${countryCode}/checkout/fail?code=PAYMENT_FAILED&message=${encodeURIComponent(
          "Almond Wallet payment was not completed."
        )}`
      )
      return
    }

    processPaymentCallback(countryCode, cartId).then((result) => {
      removeCheckoutCartByIntent(paymentIntentId)

      router.replace(result.redirectUrl)
    })
  }, [countryCode, router, searchParams])

  return (
    <div className="flex min-h-screen items-center justify-center bg-ui-bg-subtle">
      <div className="w-full max-w-md rounded-rounded bg-white p-8 shadow-elevation-card-rest">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-ui-fg-interactive" />
          <h1 className="mb-2 text-xl font-medium text-ui-fg-base">
            Completing your order
          </h1>
          <p className="text-ui-fg-subtle">
            Please wait while we finalize the Almond Wallet payment.
          </p>
        </div>
      </div>
    </div>
  )
}
