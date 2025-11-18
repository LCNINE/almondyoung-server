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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600">결제 정보를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        {/* Success Icon */}
        <div className="flex justify-center mb-6">
          <div className="rounded-full bg-green-100 p-3">
            <svg
              className="w-16 h-16 text-green-600"
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
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
          결제 성공
        </h2>
        <p className="text-gray-600 text-center mb-8">
          결제가 정상적으로 처리되었습니다.
        </p>

        {/* Payment Details */}
        <div className="space-y-4 mb-8">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">결제 ID</span>
                <span className="text-sm font-medium text-gray-900 truncate ml-2">
                  {paymentInfo.intentId}
                </span>
              </div>

              {paymentInfo.attemptId && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">시도 ID</span>
                  <span className="text-sm font-medium text-gray-900 truncate ml-2">
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
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            테스트 페이지로 돌아가기
          </button>
        </div>
      </div>
    </div>
  )
}

