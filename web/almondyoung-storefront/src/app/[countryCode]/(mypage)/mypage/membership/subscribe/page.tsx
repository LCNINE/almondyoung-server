"use client"
import { useRouter } from "next/navigation"
import React from "react"

// 멤버십 플랜 선택 페이지
export default function MembershipSubscribePage() {
  const router = useRouter()

  return (
    <div className="p-[16px] md:p-[35px]">
      <h1 className="mb-6 text-2xl font-bold">멤버십 플랜 선택</h1>

      <div className="space-y-4">
        {/* Pro 연간 플랜 */}
        <div className="rounded-lg border-2 border-gray-300 p-6 hover:border-amber-500">
          <div className="mb-4">
            <h2 className="text-xl font-bold">Pro 연간</h2>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold">189,000원</span>
              <span className="text-gray-600">/ 12개월</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              월 15,750원 (약 21% 절감)
            </p>
          </div>
          <p className="mb-4 text-sm text-gray-700">
            첫달 무료 + 2개월 무료업그레이드 혜택 적용
          </p>
          <button
            onClick={() =>
              router.push("/kr/mypage/membership/subscribe/payment")
            }
            className="w-full rounded-md bg-amber-500 py-3 font-semibold text-white"
          >
            선택하기
          </button>
        </div>

        {/* Pro 월간 플랜 */}
        <div className="rounded-lg border-2 border-gray-300 p-6 hover:border-amber-500">
          <div className="mb-4">
            <h2 className="text-xl font-bold">Pro 월간</h2>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold">19,000원</span>
              <span className="text-gray-600">/ 월</span>
            </div>
          </div>
          <button
            onClick={() =>
              router.push("/kr/mypage/membership/subscribe/payment")
            }
            className="w-full rounded-md bg-amber-500 py-3 font-semibold text-white"
          >
            선택하기
          </button>
        </div>
      </div>
    </div>
  )
}
