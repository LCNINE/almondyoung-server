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
    const status = searchParams.get("status")
    const code = searchParams.get("code")
    const message = searchParams.get("message")
    const paymentKey = searchParams.get("paymentKey")
    const orderId = searchParams.get("orderId")
    const usePoints = searchParams.get("usePoints")
    const amount = searchParams.get("amount")
    const mode = searchParams.get("mode")
    const planId = searchParams.get("planId")

    // 실패 케이스 처리 (토스에서 실패로 리다이렉트된 경우)
    if (status === "FAIL") {
      const failCode = code || "UNKNOWN"
      const failMessage = message || "결제 실패"
      router.replace(
        mode === "membership"
          ? `/${countryCode}/mypage/membership/subscribe/fail?code=${failCode}&message=${encodeURIComponent(failMessage)}`
          : `/${countryCode}/checkout/fail?code=${failCode}&message=${encodeURIComponent(failMessage)}`
      )
      return
    }

    // 필수 파라미터 검증
    if (!paymentKey || !orderId) {
      router.replace(
        mode === "membership"
          ? `/${countryCode}/mypage/membership/subscribe/fail?code=MISSING_PARAMS&message=${encodeURIComponent("필수 파라미터가 누락되었습니다.")}`
          : `/${countryCode}/checkout/fail?code=MISSING_PARAMS&message=${encodeURIComponent("필수 파라미터가 누락되었습니다.")}`
      )
      return
    }

    const usePointsNumber = usePoints ? parseInt(usePoints) : 0

    processPaymentCallback(
      countryCode,
      paymentKey,
      orderId,
      amount!,
      usePointsNumber,
      mode,
      planId
    ).then((result) => {
      router.replace(result.redirectUrl)
    })
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
