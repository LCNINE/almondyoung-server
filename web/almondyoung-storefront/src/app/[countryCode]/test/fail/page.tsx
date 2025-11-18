"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

export default function FailPage() {
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
    router.push("/test")
  }

  const handleRetry = () => {
    router.push("/test")
  }

  if (!errorInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600">오류 정보를 불러오는 중...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        {/* Error Icon */}
        <div className="flex justify-center mb-6">
          <div className="rounded-full bg-red-100 p-3">
            <svg
              className="w-16 h-16 text-red-600"
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
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
          결제 실패
        </h2>
        <p className="text-gray-600 text-center mb-8">
          결제 처리 중 문제가 발생했습니다.
        </p>

        {/* Error Details */}
        <div className="space-y-4 mb-8">
          <div className="bg-red-50 rounded-lg p-4 border border-red-200">
            <div className="space-y-3">
              <div>
                <span className="text-sm text-gray-600 block mb-1">
                  오류 코드
                </span>
                <span className="text-sm font-medium text-red-900">
                  {errorInfo.code}
                </span>
              </div>

              <div>
                <span className="text-sm text-gray-600 block mb-1">
                  오류 메시지
                </span>
                <span className="text-sm font-medium text-red-900">
                  {errorInfo.message}
                </span>
              </div>
            </div>
          </div>

          {/* Common Error Explanations */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              일반적인 오류 원인
            </h3>
            <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
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
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            다시 시도하기
          </button>
          <button
            onClick={handleGoBack}
            className="w-full bg-gray-200 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-300 transition-colors"
          >
            테스트 페이지로 돌아가기
          </button>
        </div>
      </div>
    </div>
  )
}

