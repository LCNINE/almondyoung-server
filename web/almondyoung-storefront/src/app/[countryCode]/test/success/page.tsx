"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

export default function SuccessPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [paymentInfo, setPaymentInfo] = useState<{
    intentId: string
    amount: string
    provider: string
    status: string
    attemptId?: string
  } | null>(null)

  useEffect(() => {
    const intentId = searchParams.get("intentId")
    const amount = searchParams.get("amount")
    const provider = searchParams.get("provider")
    const status = searchParams.get("status")
    const attemptId = searchParams.get("attemptId")

    if (intentId && amount && provider && status) {
      setPaymentInfo({
        intentId,
        amount,
        provider,
        status,
        attemptId: attemptId || undefined,
      })
    }
  }, [searchParams])

  const handleGoBack = () => {
    router.push("/test")
  }

  if (!paymentInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600">결제 정보를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        {/* Success Icon */}
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-green-100 p-3">
            <svg
              className="h-16 w-16 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">
          결제 성공
        </h2>
        <p className="mb-8 text-center text-gray-600">
          결제가 정상적으로 처리되었습니다.
        </p>

        {/* Payment Details */}
        <div className="mb-8 space-y-4">
          <div className="rounded-lg bg-gray-50 p-4">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">결제 ID</span>
                <span className="ml-2 truncate text-sm font-medium text-gray-900">
                  {paymentInfo.intentId}
                </span>
              </div>

              {paymentInfo.attemptId && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">시도 ID</span>
                  <span className="ml-2 truncate text-sm font-medium text-gray-900">
                    {paymentInfo.attemptId}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-sm text-gray-600">결제 금액</span>
                <span className="text-sm font-medium text-gray-900">
                  {Number(paymentInfo.amount).toLocaleString()}원
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-sm text-gray-600">결제 수단</span>
                <span className="text-sm font-medium text-gray-900">
                  {paymentInfo.provider}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-sm text-gray-600">상태</span>
                <span className="text-sm font-medium text-green-600">
                  {paymentInfo.status}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleGoBack}
            className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-700"
          >
            테스트 페이지로 돌아가기
          </button>
        </div>
      </div>
    </div>
  )
}
