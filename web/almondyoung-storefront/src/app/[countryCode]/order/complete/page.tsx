"use client"
import { CustomButton } from "@components/common/custom-buttons"
import { useState, useEffect } from "react"

export default function OrderCompletePage() {
  const [orderNumber, setOrderNumber] = useState("")
  const [orderDate, setOrderDate] = useState("")

  useEffect(() => {
    // 주문번호 생성 (실제로는 서버에서 받아옴)
    const orderNum = "ORD" + Date.now().toString().slice(-8)
    setOrderNumber(orderNum)

    // 주문일시 설정
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    const hours = String(now.getHours()).padStart(2, "0")
    const minutes = String(now.getMinutes()).padStart(2, "0")
    setOrderDate(`${year}.${month}.${day} ${hours}:${minutes}`)
  }, [])

  return (
    <main className="min-h-screen bg-[#f8f8f8]">
      {/* PC 헤더 */}
      <div className="hidden w-full border-b border-gray-200 bg-white md:block">
        <div className="container mx-auto flex max-w-[1360px] items-center justify-between px-[40px] py-5">
          <img src="/logo.png" alt="아몬드영" className="h-7" />
          <h1 className="text-2xl font-bold">주문완료</h1>
          <div></div>
        </div>
      </div>

      {/* 메인 컨텐츠 */}
      <div className="container mx-auto max-w-[1360px] px-4 md:px-[40px] md:py-8">
        {/* 모바일 헤더 */}
        <header className="mb-6 flex items-center justify-between px-4 pt-6 md:hidden">
          <h1 className="text-lg font-bold text-gray-900">주문완료</h1>
          <button aria-label="닫기" className="text-xl text-gray-500">
            ✕
          </button>
        </header>
        <div className="mx-auto max-w-[600px]">
          {/* 주문완료 메시지 */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <svg
                className="h-8 w-8 text-green-600"
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
            <h2 className="mb-2 text-2xl font-bold text-gray-900 md:text-3xl">
              주문이 완료되었습니다!
            </h2>
            <p className="text-gray-600">주문해주셔서 감사합니다.</p>
          </div>

          {/* 주문 정보 */}
          <div className="mb-6 rounded-lg bg-white p-6 md:p-8">
            <h3 className="mb-4 text-lg font-bold text-gray-900">주문 정보</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">주문번호</span>
                <span className="font-semibold text-gray-900">
                  {orderNumber}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">주문일시</span>
                <span className="font-semibold text-gray-900">{orderDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">결제수단</span>
                <span className="font-semibold text-gray-900">나중결제</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">총 결제금액</span>
                <span className="text-lg font-bold text-[#F29219]">
                  20,500원
                </span>
              </div>
            </div>
          </div>

          {/* 배송 정보 */}
          <div className="mb-6 rounded-lg bg-white p-6 md:p-8">
            <h3 className="mb-4 text-lg font-bold text-gray-900">배송 정보</h3>
            <div className="space-y-2">
              <p className="text-gray-900">이연정 (이연정)</p>
              <p className="text-gray-600">010-0000-0000</p>
              <p className="text-gray-600">
                서울특별시 강북구 도봉로 89길 27(수유동) 4층
              </p>
              <p className="mt-2 text-sm text-gray-500">
                배송 예정일: 2-3일 후
              </p>
            </div>
          </div>

          {/* 주문 상품 */}
          <div className="mb-8 rounded-lg bg-white p-6 md:p-8">
            <h3 className="mb-4 text-lg font-bold text-gray-900">주문 상품</h3>
            <div className="flex items-start gap-4">
              <img
                src="/images/product-thumb.png"
                alt="루가래쉬 플랫모"
                className="h-16 w-16 rounded object-cover md:h-20 md:w-20"
              />
              <div className="flex-1">
                <p className="mb-1 font-semibold text-gray-900">
                  루가래쉬 플랫모
                </p>
                <p className="mb-2 text-sm text-gray-600">
                  C / 0.10 / 7mm | 1개
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400 line-through">
                    30,000원
                  </span>
                  <span className="font-bold text-[#F29219]">9,000원</span>
                </div>
              </div>
            </div>
          </div>

          {/* 액션 버튼들 */}
          <div className="flex flex-col gap-3 md:flex-row mb-6">
            <CustomButton
              onClick={() => (window.location.href = "/order/track")}
              variant="secondary"
              size="lg"
              fullWidth
            >
              주문조회
            </CustomButton>
            <CustomButton
              onClick={() => (window.location.href = "/")}
              variant="primary"
              size="lg"
              fullWidth
            >
              쇼핑 계속하기
            </CustomButton>
          </div>
        </div>
      </div>
    </main>
  )
}
