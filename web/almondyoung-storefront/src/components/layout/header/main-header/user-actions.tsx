"use client"

import { useCart } from "@/contexts/cart-context"
import { useUser } from "@/contexts/user-context"
import { useSearchSheetStore } from "@hooks/ui/use-search-sheet-store"
import { Search, ShoppingCart, User } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
// import { Bell } from "lucide-react"

export function AccountMenu() {
  const { countryCode } = useParams()
  const { user } = useUser()
  const { itemCount: cartItemCount } = useCart()
  // todo: 알림 기능 활성화 시 복구
  // const hasNotification = true

  const { onOpen } = useSearchSheetStore()

  return (
    <div className="flex items-center gap-[clamp(0.5px,2vw,1.5rem)]">
      {/* 모바일 검색 */}
      <div className="flex md:hidden">
        <AccountMenuItem
          onClick={onOpen}
          icon={<Search className="h-6 w-6 md:h-8 md:w-8" color="white" />}
          label="검색"
        />
      </div>

      {/* 장바구니 */}
      <AccountMenuItem
        href={`/${countryCode}/cart`}
        icon={<ShoppingCart className="h-6 w-6 md:h-8 md:w-8" color="white" />}
        label="장바구니"
        badgeCount={cartItemCount}
      />

      {/* 로그인 / 마이페이지 */}
      <div className="hidden md:flex">
        <AccountMenuItem
          href={user ? `/${countryCode}/mypage` : `/${countryCode}/login`}
          icon={<User className="h-6 w-6 md:h-8 md:w-8" color="white" />}
          label={user ? "마이" : "로그인"}
        />
      </div>

      {/* todo: 알림 기능 미연결로 임시 비활성화 */}
      {/* <AccountMenuItem
        onClick={() => console.log("알림 열기")}
        icon={<Bell className="h-6 w-6 md:h-8 md:w-8" color="white" />}
        label="알림"
        showDot={hasNotification}
      /> */}
    </div>
  )
}

interface AccountMenuItemProps {
  href?: string
  icon: React.ReactNode
  label: string
  badgeCount?: number
  showDot?: boolean // 알림용 점 표시 여부 추가
  onClick?: () => void
}

function AccountMenuItem({
  href,
  icon,
  label,
  badgeCount,
  showDot,
  onClick,
}: AccountMenuItemProps) {
  const displayBadge =
    badgeCount && badgeCount > 0 ? (badgeCount > 99 ? "99+" : badgeCount) : null

  const content = (
    <>
      <div className="relative">
        {icon}

        {/*  숫자가 있는 배지 (장바구니 등) */}
        {displayBadge && (
          <span className="bg-yellow-30 absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full text-xs font-bold text-white md:h-5 md:w-5">
            {displayBadge}
          </span>
        )}

        {/*  숫자 없이 점만 있는 배지 (알림 등) */}
        {showDot && !displayBadge && (
          <span className="bg-yellow-30 absolute -top-1 -right-1 h-2 w-2 rounded-full md:h-2.5 md:w-2.5" />
        )}
      </div>

      <span className="hidden text-[clamp(0.625rem,1.2vw,0.75rem)] leading-none font-medium whitespace-nowrap md:block">
        {label}
      </span>
    </>
  )

  switch (Boolean(href)) {
    case true:
      return (
        <Link
          href={href ?? ""}
          className="flex flex-col items-center gap-1 text-white"
        >
          {content}
        </Link>
      )

    default:
      return (
        <button
          onClick={onClick}
          className="flex cursor-pointer flex-col items-center gap-1 text-white"
          type="button"
        >
          {content}
        </button>
      )
  }
}
