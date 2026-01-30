"use server"

import { authorizePayment } from "@/lib/api/wallet"

interface ProcessPaymentResult {
  success: boolean
  redirectUrl: string
}

export async function processPaymentCallback(
  countryCode: string,
  paymentKey: string,
  orderId: string,
  amount: string,
  usePoints: number
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

    return {
      success: true,
      redirectUrl: `/${countryCode}/checkout/success/${response.intentId}`,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류"
    console.log("error message", errorMessage)
    return {
      success: false,
      redirectUrl: `/${countryCode}/checkout/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`,
    }
  }
}
