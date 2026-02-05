"use server"

import { createSubscriptionServer } from "@/lib/api/membership"
import { authorizePayment } from "@/lib/api/wallet"
import { HttpApiError } from "@/lib/api/api-error"

interface ProcessPaymentResult {
  success: boolean
  redirectUrl: string
}

export async function processPaymentCallback(
  countryCode: string,
  paymentKey: string,
  orderId: string,
  amount: string,
  usePoints: number,
  mode?: string | null,
  planId?: string | null
): Promise<ProcessPaymentResult> {
  try {
    const response = await authorizePayment(orderId, {
      provider: "TOSS",
      authParams: { paymentKey, orderId, amount },
      usePoints,
    })

    console.log("🔍 콜백 페이지 - 승인 응답:", response)

    if (!response.success) {
      console.log("response.message:", response.message)
      return {
        success: false,
        redirectUrl: `/${countryCode}/checkout/fail?code=AUTHORIZE_ERROR&message=${encodeURIComponent(response.message || "결제 승인 실패")}`,
      }
    }

    if (!response.intentId) {
      console.log("response.intentId:", response.intentId)
      return {
        success: false,
        redirectUrl: `/${countryCode}/checkout/fail?code=MISSING_INTENT_ID&message=${encodeURIComponent("결제 승인 응답에 intentId가 없습니다.")}`,
      }
    }

    if (mode === "membership" && planId) {
      try {
        await createSubscriptionServer(planId)
        return {
          success: true,
          redirectUrl: `/${countryCode}/mypage/membership/subscribe/success`,
        }
      } catch (error: any) {
        if (error instanceof HttpApiError && error.status === 409) {
          return {
            success: true,
            redirectUrl: `/${countryCode}/mypage/membership/subscribe/success`,
          }
        }
        const message =
          error instanceof Error ? error.message : "멤버십 가입 처리 실패"
        return {
          success: false,
          redirectUrl: `/${countryCode}/mypage/membership/subscribe/fail?code=SUBSCRIBE_FAILED&message=${encodeURIComponent(message)}`,
        }
      }
    }

    return {
      success: true,
      redirectUrl: `/${countryCode}/checkout/success/${response.intentId}`,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류"
    console.log("error message", errorMessage)
    return {
      success: false,
      redirectUrl:
        mode === "membership"
          ? `/${countryCode}/mypage/membership/subscribe/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`
          : `/${countryCode}/checkout/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`,
    }
  }
}
