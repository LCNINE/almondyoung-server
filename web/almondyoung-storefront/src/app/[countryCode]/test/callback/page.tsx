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
      `/${countryCode}/test/fail?code=${code}&message=${encodeURIComponent(failMessage)}`
    )
  }

  // 필수 파라미터 검증
  const { paymentKey, orderId, amount } = queryParams
  if (!paymentKey || !orderId) {
    redirect(
      `/${countryCode}/test/fail?code=MISSING_PARAMS&message=${encodeURIComponent("필수 파라미터가 누락되었습니다.")}`
    )
  }

  try {
    // 결제 승인 API 호출 (Server-to-Server)
    const cookieStore = await cookies()
    const cookieHeader = cookieStore.toString()

    const backendUrl = process.env.BACKEND_URL || "http://localhost:5000"
    const response = await fetch(
      `${backendUrl}/wallet/payments/intents/${orderId}/authorize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          provider: "TOSS",
          authParams: {
            paymentKey: paymentKey,
          },
          amount: amount ? Number(amount) : undefined,
        }),
        cache: "no-store",
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.message || "결제 승인 실패"
      redirect(
        `/${countryCode}/test/fail?code=AUTHORIZE_ERROR&message=${encodeURIComponent(errorMessage)}`
      )
    }

    const data: AuthorizeResponse = await response.json()

    // 성공 시 -> 통합 영수증 페이지로 리다이렉트
    redirect(`/${countryCode}/test/success/${data.intentId}`)
  } catch (err) {
    console.error("콜백 처리 실패:", err)
    const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류"
    redirect(
      `/${countryCode}/test/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`
    )
  }
}
