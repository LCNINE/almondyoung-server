"use client"
import React from "react"
import { useRouter } from "next/navigation"

// --- 아이콘 Placeholder ---
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>
)
const ChevronRightIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
)

// --- 커스텀 아이콘 ---
// 1. 은행계좌 아이콘
const BankAccountIcon = () => (
  <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-lg">
    <div className="h-6 w-8 rounded bg-blue-400"></div>
  </div>
)

// 2. 카드 아이콘
const CardIcon = () => (
  <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-lg">
    <div className="h-8 w-6 rounded bg-blue-400"></div>
  </div>
)

export default function AddPaymentMethodSelector() {
  const router = useRouter()

  const menuItems = [
    {
      icon: <BankAccountIcon />,
      label: "은행계좌",
      action: () => router.push("/kr/mypage/payment-methods/add/bank"),
    },
    {
      icon: <CardIcon />,
      label: "카드",
      action: () => router.push("/kr/mypage/payment-methods/add/card"),
    },
  ]

  return (
    <main className="bg-muted min-h-screen w-full font-sans">
      {/* --- 페이지 헤더 --- */}
      <header className="flex items-center border-b bg-white p-4">
        <button aria-label="뒤로 가기" onClick={() => router.back()}>
          <BackIcon />
        </button>
        <div className="flex-grow text-center">
          <h1 className="text-lg font-bold">결제 수단 등록</h1>
        </div>
        <div className="w-6"></div> {/* 오른쪽 여백 맞추기용 */}
      </header>

      {/* --- 메인 콘텐츠 (메뉴 목록) --- */}
      <div className="p-4">
        {/* 각 항목이 클릭 가능한 메뉴이므로, 
          ul > li > button 형태로 마크업하여 시맨틱한 구조를 만듭니다.
        */}
        <ul className="space-y-3">
          {menuItems.map((item, index) => (
            <li key={index}>
              <button
                onClick={item.action}
                className="flex w-full items-center rounded-xl bg-white p-4 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.99]"
              >
                {item.icon}
                <span className="ml-4 flex-grow text-left text-base font-semibold text-gray-800">
                  {item.label}
                </span>
                <span className="text-gray-300">
                  <ChevronRightIcon />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
