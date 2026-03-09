"use client"

import { useEffect } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import {
  getCheckoutCartByIntent,
  removeCheckoutCartByIntent,
} from "@/lib/utils/checkout-intent-map"
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

    // 하위 호환: 기존 흐름의 cartId 쿼리가 있으면 우선 사용
    const cartIdFromQuery = searchParams.get("cartId")
    const cartId =
      cartIdFromQuery ||
      (paymentIntentId ? getCheckoutCartByIntent(paymentIntentId) : null)

    if (status !== "succeeded") {
      if (paymentIntentId) {
        removeCheckoutCartByIntent(paymentIntentId)
      }
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

    // 멤버십 결제: server action의 accessToken 쿠키 접근 불가 문제로 client-side fetch 사용
    // (크로스도메인 지갑 리다이렉트 후 서버 사이드에서 쿠키가 전달되지 않는 문제 우회)
    if (mode === "membership" && planId) {
      fetch(`/api/membership/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ planId }),
      })
        .then(async (res) => {
          removeCheckoutCartByIntent(paymentIntentId)
          if (res.ok || res.status === 409) {
            router.replace(
              `/${countryCode}/mypage/membership/subscribe/success`
            )
          } else {
            const errorData = await res.json().catch(() => ({}))
            const message = errorData?.message || "멤버십 가입 처리 실패"
            router.replace(
              `/${countryCode}/mypage/membership/subscribe/fail?code=SUBSCRIBE_FAILED&message=${encodeURIComponent(message)}`
            )
          }
        })
        .catch(() => {
          removeCheckoutCartByIntent(paymentIntentId)
          router.replace(
            `/${countryCode}/mypage/membership/subscribe/fail?code=CALLBACK_ERROR&message=${encodeURIComponent("멤버십 결제 처리 중 오류가 발생했습니다.")}`
          )
        })
      return
    }

    processPaymentCallback(countryCode, paymentIntentId, mode, planId, cartId).then(
      (result) => {
        removeCheckoutCartByIntent(paymentIntentId)
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
