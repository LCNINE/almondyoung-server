"use client"

import { useEffect } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { processPaymentCallback } from "./actions"

export default function CallbackPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()

  const countryCode = params.countryCode as string

  useEffect(() => {
    const paymentIntentId = searchParams.get("payment_intent_id")
    const status = searchParams.get("status")
    const mode = searchParams.get("mode")
    const planId = searchParams.get("planId")
    const cartId = searchParams.get("cartId")

    if (status !== "succeeded") {
      router.replace(
        mode === "membership"
          ? `/${countryCode}/mypage/membership/subscribe/fail?code=PAYMENT_FAILED&message=${encodeURIComponent("결제에 실패했습니다.")}`
          : `/${countryCode}/checkout/fail?code=PAYMENT_FAILED&message=${encodeURIComponent("결제에 실패했습니다.")}`
      )
      return
    }

    if (!paymentIntentId) {
      router.replace(
        mode === "membership"
          ? `/${countryCode}/mypage/membership/subscribe/fail?code=MISSING_PARAMS&message=${encodeURIComponent("결제 정보가 없습니다.")}`
          : `/${countryCode}/checkout/fail?code=MISSING_PARAMS&message=${encodeURIComponent("결제 정보가 없습니다.")}`
      )
      return
    }

    processPaymentCallback(countryCode, paymentIntentId, mode, planId, cartId).then(
      (result) => {
        router.replace(result.redirectUrl)
      }
    )
  }, [countryCode, searchParams, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f8f8]">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center">
          {/* Loading Spinner */}
          <div className="mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-[#F29219]"></div>

          <h2 className="mb-2 text-2xl font-bold text-gray-900">
            결제 처리 중
          </h2>
          <p className="text-center text-gray-600">결제를 처리 중입니다...</p>

          <div className="mt-6 text-center text-sm text-gray-500">
            잠시만 기다려주세요.
            <br />
            페이지를 닫거나 새로고침하지 마세요.
          </div>
        </div>
      </div>
    </div>
  )
}
