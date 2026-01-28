import { redirect } from "next/navigation"
import { authorizePayment } from "@/lib/api/wallet"

interface PageProps {
  searchParams: Promise<{
    paymentKey?: string
    orderId?: string
    amount?: string
    status?: string
    code?: string
    message?: string
  }>
  params: Promise<{ countryCode: string }>
}

export default async function CallbackPage({
  searchParams,
  params,
}: PageProps) {
  const { countryCode } = await params
  const queryParams = await searchParams

  // 실패 케이스 처리 (토스에서 실패로 리다이렉트된 경우)
  if (queryParams.status === "FAIL") {
    const code = queryParams.code || "UNKNOWN"
    const failMessage = queryParams.message || "결제 실패"
    console.log("============== 토스에서 실패로 리다이렉트된 경우 ====")
    console.log("code", code)
    console.log("fail message", failMessage)
    // redirect(
    //   `/${countryCode}/checkout/fail?code=${code}&message=${encodeURIComponent(failMessage)}`
    // )
  }

  // 필수 파라미터 검증
  const { paymentKey, orderId } = queryParams
  if (!paymentKey || !orderId) {
    console.log("============== 필수 파라미터 검증 실패 ====")
    console.log("paymentKey", paymentKey)
    console.log("orderId", orderId)
    // redirect(
    //   `/${countryCode}/checkout/fail?code=MISSING_PARAMS&message=${encodeURIComponent("필수 파라미터가 누락되었습니다.")}`
    // )
    return
  }

  try {
    console.log("🔍 콜백 페이지 - 승인 요청:", {
      intentId: orderId,
      paymentKey,
    })

    // authorizePayment 함수 사용
    const response = await authorizePayment(orderId, {
      provider: "TOSS",
      authParams: { paymentKey },
    })

    console.log("🔍 콜백 페이지 - 승인 응답:", response)

    if (!response.success) {
      console.log("============== 승인 실패 ====")
      console.error("❌ 콜백 페이지 - 승인 실패:", response)
      // redirect(
      //   `/${countryCode}/checkout/fail?code=AUTHORIZE_ERROR&message=${encodeURIComponent(response.message || "결제 승인 실패")}`
      // )
    }

    // if (!response.intentId) {
    //   console.error("❌ 콜백 페이지 - intentId 없음:", response)
    //   redirect(
    //     `/${countryCode}/checkout/fail?code=MISSING_INTENT_ID&message=${encodeURIComponent("결제 승인 응답에 intentId가 없습니다.")}`
    //   )
    // }

    // // 성공 시 -> 성공 페이지로 리다이렉트
    // redirect(`/${countryCode}/checkout/success/${response.intentId}`)
  } catch (err) {
    // NEXT_REDIRECT 에러는 정상적인 리다이렉트이므로 다시 던짐
    if (err instanceof Error && err.message === "NEXT_REDIRECT") {
      throw err
    }

    const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류"
    console.log("error message", errorMessage)
    // redirect(
    //   `/${countryCode}/checkout/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`
    // )
  }
}
