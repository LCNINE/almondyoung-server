"use client"
import { useSearchParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import CheckoutHeader from "@/app/[countryCode]/(checkout)/checkout/checkout-header"

export default function CheckoutFailPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [errorInfo, setErrorInfo] = useState<{
    code: string
    message: string
  } | null>(null)

  useEffect(() => {
    const code = searchParams.get("code") || "UNKNOWN_ERROR"
    const message =
      searchParams.get("message") || "알 수 없는 오류가 발생했습니다."

    setErrorInfo({ code, message })
  }, [searchParams])

  const handleGoBack = () => {
    router.back()
  }

  const handleRetry = () => {
    router.back()
  }

  if (!errorInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8f8f8]">
        <div className="text-center">
          <p className="text-gray-600">오류 정보를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <main className="flex min-h-screen w-full flex-col items-center gap-[41px] bg-[#f8f8f8] pb-20">
      <CheckoutHeader title="주문/결제" />

      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        {/* Error Icon */}
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-red-100 p-3">
            <svg
              className="h-16 w-16 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
          결제 실패
        </h1>
        <p className="mb-8 text-center text-gray-600">
          결제 처리 중 문제가 발생했습니다.
        </p>

        {/* Error Details */}
        <div className="mb-8 space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <div className="space-y-3">
              <div>
                <span className="mb-1 block text-sm text-gray-600">
                  오류 코드
                </span>
                <span className="text-sm font-medium text-red-900">
                  {errorInfo.code}
                </span>
              </div>

              <div>
                <span className="mb-1 block text-sm text-gray-600">
                  오류 메시지
                </span>
                <span className="text-sm font-medium text-red-900">
                  {errorInfo.message}
                </span>
              </div>
            </div>
          </div>

          {/* Common Error Explanations */}
          <div className="rounded-lg bg-gray-50 p-4">
            <h3 className="mb-2 text-sm font-medium text-gray-900">
              일반적인 오류 원인
            </h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
              <li>결제 한도 초과</li>
              <li>카드 정보 오류</li>
              <li>잔액 부족</li>
              <li>사용자가 결제 취소</li>
              <li>네트워크 오류</li>
            </ul>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleRetry}
            className="w-full rounded-lg bg-[#F29219] py-3 font-medium text-white transition-colors hover:bg-[#e08219]"
          >
            다시 시도하기
          </button>
          <button
            onClick={handleGoBack}
            className="w-full rounded-lg bg-gray-200 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-300"
          >
            이전 페이지로 돌아가기
          </button>
        </div>
      </div>
    </main>
  )
}
