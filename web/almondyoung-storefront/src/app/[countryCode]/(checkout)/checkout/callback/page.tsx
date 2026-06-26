"use client"

import { useEffect } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  getCheckoutCartByIntent,
  removeCheckoutCartByIntent,
  getPendingPaymentMode,
  removePendingPaymentMode,
} from "@/lib/utils/checkout-intent-map"
import { processPaymentCallback, revalidateMembershipSuccess } from "./actions"

const getErrorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback

// 콜백 effect 더블런/중복 콜백으로 동일 payment_intent 가 두 번 처리되는 것을 막는 in-memory 가드.
// 두 번째 처리는 이미 완료된 카트를 다시 complete 하려다 실패해, 성공한 결제를 실패페이지로 뒤집는다.
const processedCallbackIntents = new Set<string>()

export default function CallbackPage() {
  const t = useTranslations("checkout.callback")
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()

  const countryCode = params.countryCode as string

  useEffect(() => {
    let cancelled = false

    const failUrl = (code: string, message: string, mode?: string | null) =>
      mode === "membership"
        ? `/${countryCode}/mypage/membership/subscribe/fail?code=${code}&message=${encodeURIComponent(message)}`
        : `/${countryCode}/checkout/fail?code=${code}&message=${encodeURIComponent(message)}`

    const replace = (url: string) => {
      if (!cancelled) {
        router.replace(url)
      }
    }

    const clearPendingPayment = (paymentIntentId?: string | null) => {
      if (paymentIntentId) {
        removeCheckoutCartByIntent(paymentIntentId)
      }
      removePendingPaymentMode()
    }

    const handleCallback = async () => {
      const paymentIntentId = searchParams.get("payment_intent_id")
      const status = searchParams.get("status")
      // URL에 mode가 없으면 sessionStorage fallback (returnUrl에 쿼리가 있을 때 wallet이 URL을 깨뜨리는 문제 대응)
      const pendingMode = getPendingPaymentMode()
      const mode = searchParams.get("mode") ?? pendingMode?.mode ?? null

      // 하위 호환: 기존 흐름의 cartId 쿼리가 있으면 우선 사용
      const cartIdFromQuery = searchParams.get("cartId")
      const cartId =
        cartIdFromQuery ||
        (paymentIntentId ? getCheckoutCartByIntent(paymentIntentId) : null)

      if (status !== "succeeded") {
        clearPendingPayment(paymentIntentId)
        replace(failUrl("PAYMENT_FAILED", t("paymentFailed"), mode))
        return
      }

      if (!paymentIntentId) {
        replace(failUrl("MISSING_PARAMS", t("missingParams"), mode))
        return
      }

      // 동일 intent 1회만 처리 (서버 멱등 가드와 함께 이중 방어)
      if (processedCallbackIntents.has(paymentIntentId)) return
      processedCallbackIntents.add(paymentIntentId)

      // 멤버십 결제: JWT 없이 wallet payment intent 검증으로 구독 확정
      // (크로스도메인 지갑 리다이렉트 후 accessToken 쿠키 소실 문제 우회)
      if (mode === "membership") {
        try {
          const res = await fetch(
            `/api/membership/subscriptions/confirm-checkout-intent`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intentId: paymentIntentId }),
            }
          )

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
            revalidateMembershipSuccess().catch(() => {})
            replace(`/${countryCode}/mypage/membership/subscribe/success`)
          } else {
            const errorData = await res.json().catch(() => ({}))
            const message = errorData?.message || t("membershipFailFallback")
            replace(failUrl("SUBSCRIBE_FAILED", message, mode))
          }
        } catch (err) {
          removeCheckoutCartByIntent(paymentIntentId)
          removePendingPaymentMode()
          replace(
            failUrl(
              "CALLBACK_ERROR",
              getErrorMessage(err, t("membershipCallbackError")),
              mode
            )
          )
        }
        return
      }

      try {
        const result = await processPaymentCallback(
          countryCode,
          paymentIntentId,
          mode,
          cartId
        )
        removeCheckoutCartByIntent(paymentIntentId)
        removePendingPaymentMode()
        if (result.success) {
          try {
            await fetch("/api/auth/restore-token", {
              method: "POST",
              credentials: "include",
            })
          } catch {
            // 복구 실패해도 성공/실패 페이지 라우팅은 계속 진행한다.
          }
        }
        replace(result.redirectUrl)
      } catch (err) {
        removeCheckoutCartByIntent(paymentIntentId)
        removePendingPaymentMode()
        replace(
          failUrl(
            "CALLBACK_ERROR",
            getErrorMessage(err, t("callbackError")),
            mode
          )
        )
      }
    }

    handleCallback().catch((err) => {
      replace(
        failUrl("CALLBACK_ERROR", getErrorMessage(err, t("callbackError")))
      )
    })

    return () => {
      cancelled = true
    }
  }, [countryCode, searchParams, router, t])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f8f8]">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center">
          {/* Loading Spinner */}
          <div className="mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-[#F29219]"></div>

          <h2 className="mb-2 text-2xl font-bold text-gray-900">
            {t("processingTitle")}
          </h2>
          <p className="text-center text-gray-600">{t("processingDesc")}</p>

          <div className="mt-6 text-center text-sm text-gray-500">
            {t("waitLine1")}
            <br />
            {t("waitLine2")}
          </div>
        </div>
      </div>
    </div>
  )
}
