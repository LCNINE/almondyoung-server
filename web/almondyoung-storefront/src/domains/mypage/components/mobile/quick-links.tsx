import React from "react"
import Link from "next/link"
import { Package, Heart, ShoppingBag, Eye } from "lucide-react"

// --- 1. 재사용 가능한 메뉴 아이템 컴포넌트 ---
interface QuickMenuItemProps {
  icon: React.ReactNode
  label: string
  href: string
}

function QuickMenuItem({ icon, label, href }: QuickMenuItemProps) {
  return (
    <Link
      href={href}
      className="group flex flex-1 flex-col items-center justify-center gap-[6px]"
    >
      {/* 아이콘 영역 */}
      <div className="relative h-[27px] w-[27px]">{icon}</div>
      {/* 텍스트 영역 */}
      <span className="text-center font-['Pretendard'] text-xs whitespace-nowrap text-black">
        {label}
      </span>
    </Link>
  )
}

// --- 2. 메인 퀵 메뉴 컴포넌트 ---
export function QuickLinks() {
  return (
    <nav
      className="flex w-full items-center justify-between rounded-[10px] bg-white py-[15px] shadow-sm"
      aria-label="퀵 메뉴"
    >
      <QuickMenuItem
        label="주문목록"
        icon={<Package size={27} className="text-amber-500" />}
        href="/kr/mypage/order/list"
      />
      {/* <QuickMenuItem
        label="찜한상품"
        icon={<Heart size={27} className="text-amber-500" />}
        href="/kr/mypage/wish"
      /> */}
      {/* <QuickMenuItem
        label="자주산상품"
        icon={<ShoppingBag size={27} className="text-amber-500" />}
        href="/kr/mypage/rebuy"
      /> */}
      {/* <QuickMenuItem
        label="최근 본 상품"
        icon={<Eye size={27} className="text-amber-500" />}
        href="/kr/mypage/recent"
      /> */}
    </nav>
  )
}
