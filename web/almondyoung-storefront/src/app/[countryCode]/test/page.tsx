"use client"

import { useRef, useState } from "react"
import { loadTossPayments } from "@tosspayments/tosspayments-sdk"

interface IntentResponse {
  id: string
  customerId: string
  amount: number
  type: string
  status: string
  createdAt: string
  updatedAt: string
}

export default function TestPage() {
  const [intent, setIntent] = useState<IntentResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paymentRef = useRef<any>(null)

  // Intent 생성
  const createIntent = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`/api/wallet/payments/intents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId: `test_customer_${Date.now()}`,
          amount: 100,
          type: "ORDER",
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "Intent 생성 실패")
      }

      const data: IntentResponse = await response.json()
      setIntent(data)

      // Intent 생성 후 토스 결제 SDK 초기화
      await initializeTossPayment(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
      console.error("Intent 생성 실패:", err)
    } finally {
      setLoading(false)
    }
  }

  // 토스 결제 SDK 초기화
  const initializeTossPayment = async (intentData: IntentResponse) => {
    try {
      const clientKey = "test_ck_pP2YxJ4K87ZZmMga5K59rRGZwXLO"
      const tossPayments = await loadTossPayments(clientKey)

      // 표준 결제창 사용
      const payment = tossPayments.payment({
        customerKey: intentData.customerId,
      })

      paymentRef.current = payment
      console.log("✅ 토스 결제 SDK 초기화 완료")
    } catch (err) {
      setError(
        "토스 SDK 초기화 실패: " +
          (err instanceof Error ? err.message : "알 수 없는 오류")
      )
      console.error("토스 SDK 초기화 실패:", err)
    }
  }

  // 결제 요청
  const handlePayment = async () => {
    if (!intent || !paymentRef.current) {
      setError("Intent가 초기화되지 않았습니다.")
      return
    }

    try {
      setLoading(true)
      setError(null)

      const baseUrl = window.location.origin
      const countryCode = window.location.pathname.split("/")[1]

      // 표준 결제창으로 카드 결제 요청
      await paymentRef.current.requestPayment({
        method: "CARD", // 카드 결제
        amount: {
          currency: "KRW",
          value: intent.amount,
        },
        orderId: intent.id, // intentId를 orderId로 사용
        orderName: "테스트 상품",
        successUrl: `${baseUrl}/${countryCode}/test/callback`,
        failUrl: `${baseUrl}/${countryCode}/test/callback`,
        customerEmail: "customer123@gmail.com",
        customerName: "김토스",
        customerMobilePhone: "01012341234",
        card: {
          useEscrow: false,
          flowMode: "DEFAULT",
          useCardPoint: false,
          useAppCardOnly: false,
        },
      })

      console.log("✅ 결제창 요청 성공")
    } catch (err: any) {
      if (err?.code === "USER_CANCEL") {
        setError("결제가 취소되었습니다.")
        return
      }

      setError("결제 요청 실패: " + (err?.message || "알 수 없는 오류"))
      console.error("결제 요청 실패:", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-3xl font-bold">토스 결제 테스트</h1>

      {/* Intent 생성 버튼 */}
      <div className="mb-6">
        <button
          onClick={createIntent}
          disabled={loading || !!intent}
          className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {loading ? "처리 중..." : intent ? "Intent 생성 완료" : "Intent 생성"}
        </button>
      </div>

      {/* Intent 정보 표시 */}
      {intent && (
        <div className="mb-6 rounded border border-gray-200 bg-gray-50 p-4">
          <h2 className="mb-2 text-xl font-semibold">Intent 정보</h2>
          <p>
            <strong>Intent ID:</strong> {intent.id}
          </p>
          <p>
            <strong>금액:</strong> {intent.amount.toLocaleString()}원
          </p>
          <p>
            <strong>상태:</strong> {intent.status}
          </p>

          {/* 결제 버튼 */}
          <button
            onClick={handlePayment}
            disabled={loading}
            className="mt-4 w-full rounded bg-blue-600 py-3 font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {loading ? "처리 중..." : "결제하기"}
          </button>
        </div>
      )}

      {/* 에러 메시지 */}
      {error && (
        <div className="mb-6 rounded border border-red-400 bg-red-100 p-4 text-red-700">
          <strong>오류:</strong> {error}
        </div>
      )}
    </div>
  )
}
