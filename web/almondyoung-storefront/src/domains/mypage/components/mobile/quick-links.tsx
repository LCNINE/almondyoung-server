import React from "react"
import {
  OrderListIcon,
  WishlistIcon,
  FrequentPurchaseIcon,
  RecentViewIcon,
} from "components/common/icons"

// --- 1. 재사용 가능한 메뉴 아이템 컴포넌트 ---
interface QuickMenuItemProps {
  icon: React.ReactNode
  label: string
  onClick?: () => void
}

function QuickMenuItem({ icon, label, onClick }: QuickMenuItemProps) {
  return (
    // flex-1: 아이템들이 공간을 균등하게 차지하도록 합니다.
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-1 flex-col items-center justify-center gap-[6px]"
    >
      {/* 아이콘 영역 */}
      <div className="relative h-[27px] w-[27px]">{icon}</div>
      {/* 텍스트 영역 */}
      <span className="text-center font-['Pretendard'] text-xs whitespace-nowrap text-black">
        {label}
      </span>
    </button>
  )
}

// --- 2. 메인 퀵 메뉴 컴포넌트 ---
export function QuickLinks() {
  return (
    <nav
      className="flex w-full items-center justify-between rounded-[10px] bg-white py-[15px] shadow-sm"
      aria-label="퀵 메뉴"
    >
      <QuickMenuItem label="주문목록" icon={<OrderListIcon size={27} />} />
      <QuickMenuItem label="찜한상품" icon={<WishlistIcon size={27} />} />
      <QuickMenuItem
        label="자주산상품"
        icon={<FrequentPurchaseIcon size={27} />}
      />
      <QuickMenuItem label="최근 본 상품" icon={<RecentViewIcon size={27} />} />
    </nav>
  )
}
