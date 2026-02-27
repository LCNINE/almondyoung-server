"use server"

import { createSubscriptionServer } from "@/lib/api/membership"
import { HttpApiError } from "@/lib/api/api-error"

interface ProcessPaymentResult {
  success: boolean
  redirectUrl: string
}

export async function processPaymentCallback(
  countryCode: string,
  intentId: string,
  mode?: string | null,
  planId?: string | null
): Promise<ProcessPaymentResult> {
  try {
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
      redirectUrl: `/${countryCode}/checkout/success/${intentId}`,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류"
    return {
      success: false,
      redirectUrl:
        mode === "membership"
          ? `/${countryCode}/mypage/membership/subscribe/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`
          : `/${countryCode}/checkout/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`,
    }
  }
}
