"use client"

import { useEffect } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import {
  getCheckoutCartByIntent,
  removeCheckoutCartByIntent,
  getPendingPaymentMode,
  removePendingPaymentMode,
} from "@/lib/utils/checkout-intent-map"
import { processPaymentCallback, revalidateMembershipSuccess } from "./actions"

export default function CallbackPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()

  const countryCode = params.countryCode as string

  useEffect(() => {
    const paymentIntentId = searchParams.get("payment_intent_id")
    const status = searchParams.get("status")
    // URL에 mode가 없으면 sessionStorage fallback (returnUrl에 쿼리가 있을 때 wallet이 URL을 깨뜨리는 문제 대응)
    const pendingMode = getPendingPaymentMode()
    const mode = searchParams.get("mode") ?? pendingMode?.mode ?? null
    const planId = searchParams.get("planId") ?? pendingMode?.planId ?? null

    // 하위 호환: 기존 흐름의 cartId 쿼리가 있으면 우선 사용
    const cartIdFromQuery = searchParams.get("cartId")
    const cartId =
      cartIdFromQuery ||
      (paymentIntentId ? getCheckoutCartByIntent(paymentIntentId) : null)

    if (status !== "succeeded") {
      if (paymentIntentId) {
        removeCheckoutCartByIntent(paymentIntentId)
      }
      removePendingPaymentMode()
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

    // 멤버십 결제: JWT 없이 wallet payment intent 검증으로 구독 확정
    // (크로스도메인 지갑 리다이렉트 후 accessToken 쿠키 소실 문제 우회)
    if (mode === "membership") {
      fetch(`/api/membership/subscriptions/confirm-checkout-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: paymentIntentId }),
      })
        .then(async (res) => {
          removeCheckoutCartByIntent(paymentIntentId)
          removePendingPaymentMode()
          if (res.ok || res.status === 409) {
            // SameSite=Strict 쿠키는 크로스도메인 리다이렉트 시 전송되지 않음
            // ProtectedRoute(fetchMe)가 accessToken 없이 실패하는 것을 방지하기 위해
            // 성공 페이지 진입 전에 refreshToken으로 accessToken을 복구
            try {
              await fetch("/api/auth/restore-token", {
                method: "POST",
                credentials: "include",
              })
            } catch {
              // 복구 실패해도 성공 페이지로 이동 (error.tsx가 처리)
            }
            revalidateMembershipSuccess().catch(() => { })
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
          removePendingPaymentMode()
          router.replace(
            `/${countryCode}/mypage/membership/subscribe/fail?code=CALLBACK_ERROR&message=${encodeURIComponent("멤버십 결제 처리 중 오류가 발생했습니다.")}`
          )
        })
      return
    }

    processPaymentCallback(countryCode, paymentIntentId, mode, planId, cartId).then(
      (result) => {
        removeCheckoutCartByIntent(paymentIntentId)
        removePendingPaymentMode()
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
