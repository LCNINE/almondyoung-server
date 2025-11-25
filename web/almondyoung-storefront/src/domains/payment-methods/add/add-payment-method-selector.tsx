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

interface AddPaymentMethodSelectorProps {
  onSelect?: (type: "bank") => void
}

export default function AddPaymentMethodSelector({
  onSelect,
}: AddPaymentMethodSelectorProps) {
  const router = useRouter()

  const handleSelect = (type: "bank") => {
    if (onSelect) {
      onSelect(type)
    } else {
      router.push(`/kr/mypage/payment-methods/add/${type}`)
    }
  }

  const menuItems = [
    {
      icon: <BankAccountIcon />,
      label: "은행계좌",
      action: () => handleSelect("bank"),
    },
  ]

  return (
    <main className="bg-muted min-h-full w-full font-sans">
      {/* --- 페이지 헤더 --- */}
      {/* 모달 내부에서는 헤더 스타일을 조금 조정하거나 유지 */}
      <header className="flex items-center border-b bg-white p-4">
        {/* 모달이 아닐 때만 뒤로가기? 혹은 모달에서도 닫기 역할? 
            모달에서는 상위 Drawer에서 닫기를 처리하므로 여기서는 숨기거나 
            onSelect가 없을 때만 보여주는 식으로 처리 가능.
            하지만 디자인 일관성을 위해 유지하되, 모달일 경우엔 아무 동작 안하거나 닫기?
            현재 Drawer 구현상 백버튼은 'selector' 단계에선 닫기 역할을 함.
            하지만 여기서는 router.back()을 호출하고 있음.
            모달 내에서는 router.back()이 모달을 닫는 효과(popstate)를 줄 수 있으므로 그대로 둬도 됨.
        */}
        {!onSelect && (
          <button aria-label="뒤로 가기" onClick={() => router.back()}>
            <BackIcon />
          </button>
        )}
        <div className={`grow text-center ${!onSelect ? "" : "pl-6"}`}>
          <h1 className="text-lg font-bold">나중결제수단 등록</h1>
        </div>
        {!onSelect && <div className="w-6"></div>} {/* 오른쪽 여백 맞추기용 */}
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
                <span className="ml-4 grow text-left text-base font-semibold text-gray-800">
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
