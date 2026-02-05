"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

export default function Error() {
  const router = useRouter()

  return (
    <div className="flex min-h-[calc(100vh-100px)] items-center justify-center">
      <div className="text-center">
        <div className="mb-8">
          <svg
            className="mx-auto h-16 w-16 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <h1 className="mb-4 text-2xl font-bold text-gray-900">
          죄송합니다. 문제가 발생했습니다.
        </h1>

        <p className="mb-8 text-gray-600">
          일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.
        </p>

        <div className="space-x-4">
          <Button onClick={() => router.push("/")} variant="secondary">
            홈으로 돌아가기
          </Button>

          <CustomButton onClick={() => router.refresh()} variant="fill">
            새로고침
          </CustomButton>
        </div>
      </div>
    </div>
  )
}
