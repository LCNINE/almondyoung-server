import { redirect } from "next/navigation"
import { cookies } from "next/headers"

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

interface AuthorizeResponse {
  success: boolean
  intentId: string
  attemptId?: string
  status: string
  provider: string
  amount: number
  paymentKey: string | null
  message: string
  breakdown?: {
    totalAmount: number
    pointsUsed: number
    finalAmount: number
  }
}

export default async function CallbackPage({
  searchParams,
  params,
}: PageProps) {
  const { countryCode } = await params
  const queryParams = await searchParams

  // 실패 케이스 처리
  if (queryParams.status === "FAIL") {
    const code = queryParams.code || "UNKNOWN"
    const failMessage = queryParams.message || "결제 실패"
    redirect(
      `/${countryCode}/checkout/fail?code=${code}&message=${encodeURIComponent(failMessage)}`
    )
  }

  // 필수 파라미터 검증
  const { paymentKey, orderId, amount } = queryParams
  if (!paymentKey || !orderId) {
    redirect(
      `/${countryCode}/checkout/fail?code=MISSING_PARAMS&message=${encodeURIComponent("필수 파라미터가 누락되었습니다.")}`
    )
  }

  try {
    // 결제 승인 API 호출 (Server-to-Server)
    const cookieStore = await cookies()
    const cookieHeader = cookieStore.toString()

    const backendUrl = process.env.BACKEND_URL || "http://localhost:5000"

    // 요청 body 구성
    const requestBody = {
      provider: "TOSS" as const,
      authParams: {
        paymentKey: paymentKey,
      },
    }

    console.log("🔍 콜백 페이지 - 승인 요청:", {
      intentId: orderId,

      body: requestBody,
    })

    const response = await fetch(
      `${process.env.APP_URL}/api/wallet/payments/intents/${orderId}/authorize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(requestBody),
        cache: "no-store",
      }
    )

    console.log("🔍 콜백 페이지 - 승인 응답:", {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.message || "결제 승인 실패"
      console.error("❌ 콜백 페이지 - 승인 실패:", errorData)
      redirect(
        `/${countryCode}/checkout/fail?code=AUTHORIZE_ERROR&message=${encodeURIComponent(errorMessage)}`
      )
    }

    const responseData = await response.json()

    console.log("🔍 콜백 페이지 - 응답 데이터:", {
      responseData,
      hasData: !!responseData.data,
      hasIntentId: !!responseData.data?.intentId,
      intentId: responseData.data?.intentId,
    })

    // 응답이 { data: { ... } } 형태로 감싸져 있을 수 있으므로 처리
    const data: AuthorizeResponse = responseData.data || responseData

    if (!data.intentId) {
      console.error("❌ 콜백 페이지 - intentId 없음:", { responseData, data })
      redirect(
        `/${countryCode}/checkout/fail?code=MISSING_INTENT_ID&message=${encodeURIComponent("결제 승인 응답에 intentId가 없습니다.")}`
      )
    }

    // 성공 시 -> 통합 영수증 페이지로 리다이렉트
    // redirect()는 내부적으로 에러를 던지므로 catch하지 않음
    redirect(`/${countryCode}/checkout/success/${data.intentId}`)
  } catch (err) {
    // NEXT_REDIRECT 에러는 정상적인 리다이렉트이므로 다시 던짐
    if (err instanceof Error && err.message === "NEXT_REDIRECT") {
      throw err
    }

    console.error("콜백 처리 실패:", err)
    const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류"
    redirect(
      `/${countryCode}/checkout/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`
    )
  }
}
