"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"

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

export default function CallbackPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<"processing" | "success" | "error">(
    "processing"
  )
  const [message, setMessage] = useState("결제를 처리 중입니다...")

  useEffect(() => {
    const processCallback = async () => {
      try {
        // URL 파라미터 파싱
        const paymentKey = searchParams.get("paymentKey")
        const orderId = searchParams.get("orderId")
        const callbackStatus = searchParams.get("status")

        // 실패 케이스 처리
        if (callbackStatus === "FAIL") {
          const code = searchParams.get("code")
          const failMessage = searchParams.get("message")
          router.push(
            `/test/fail?code=${code || "UNKNOWN"}&message=${encodeURIComponent(failMessage || "결제 실패")}`
          )
          return
        }

        // 필수 파라미터 검증
        if (!paymentKey || !orderId) {
          throw new Error("필수 파라미터가 누락되었습니다.")
        }

        setMessage("결제 승인을 요청 중입니다...")

        // 결제 승인 API 호출
        // todo: 라우트핸들러 만들어야함
        const response = await fetch(
          `${process.env.APP_URL}/api/wallet/payments/intents/${orderId}/authorize`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              provider: "TOSS",
              authParams: {
                paymentKey: paymentKey,
              },
            }),
          }
        )

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.message || "결제 승인 실패")
        }

        const data: AuthorizeResponse = await response.json()

        // 성공 페이지로 리다이렉트
        const params = new URLSearchParams({
          intentId: data.intentId,
          amount: data.amount.toString(),
          provider: data.provider,
          status: data.status,
        })

        if (data.attemptId) {
          params.append("attemptId", data.attemptId)
        }

        router.push(`/test/success?${params.toString()}`)
      } catch (err) {
        console.error("콜백 처리 실패:", err)
        const errorMessage =
          err instanceof Error ? err.message : "알 수 없는 오류"
        router.push(
          `/test/fail?code=CALLBACK_ERROR&message=${encodeURIComponent(errorMessage)}`
        )
      }
    }

    processCallback()
  }, [searchParams, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center">
          {/* Loading Spinner */}
          <div className="mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-blue-600"></div>

          <h2 className="mb-2 text-2xl font-bold text-gray-900">
            결제 처리 중
          </h2>
          <p className="text-center text-gray-600">{message}</p>

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
