"use client"

import { useSearchSheetStore } from "@hooks/ui/use-search-sheet-store"
import { useUser } from "@/contexts/user-context"
import { Bell, Search, ShoppingCart, User } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"

export function UserActions() {
  const { countryCode } = useParams()
  const { user } = useUser()

  // todo: 임시임
  const cartItemCount = 1
  const hasNotification = true

  const { onOpen } = useSearchSheetStore()

  return (
    <div className="flex items-center gap-[clamp(0.5px,2vw,1.5rem)]">
      <div className="flex md:hidden">
        {/* 검색 */}
        <UserActionButton
          onClick={onOpen}
          icon={<Search className="h-6 w-6 md:h-8 md:w-8" color="white" />}
          label="검색"
        />
      </div>

      {/* 장바구니 */}
      <UserActionButton
        href={`/${countryCode}/cart`}
        icon={<ShoppingCart className="h-6 w-6 md:h-8 md:w-8" color="white" />}
        label="장바구니"
        badgeCount={cartItemCount}
      />

      {/* 로그인 / 마이페이지 */}
      <div className="hidden md:flex">
        <UserActionButton
          href={user ? `/${countryCode}/mypage` : `/${countryCode}/login`}
          icon={<User className="h-6 w-6 md:h-8 md:w-8" color="white" />}
          label={user ? "마이" : "로그인"}
        />
      </div>

      {/* 알림 */}
      <NotificationButton hasDot={hasNotification} label="알림" />
    </div>
  )
}

interface UserActionButtonProps {
  href?: string
  icon: React.ReactNode
  label: string
  badgeCount?: number
  onClick?: () => void
}

function UserActionButton({
  href,
  icon,
  label,
  badgeCount,
  onClick,
}: UserActionButtonProps) {
  const displayBadge =
    badgeCount && badgeCount > 0 ? (badgeCount > 99 ? "99+" : badgeCount) : null

  switch (Boolean(href)) {
    case true:
      return (
        <Link
          href={href ?? ""}
          className="flex-col items-center gap-1 text-white md:flex"
        >
          <div className="relative">
            {icon}

            {displayBadge && (
              <span className="bg-yellow-30 absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full text-xs font-bold text-white md:h-5 md:w-5">
                {displayBadge}
              </span>
            )}
          </div>
          <span className="hidden text-[clamp(0.625rem,1.2vw,0.75rem)] leading-none font-medium whitespace-nowrap md:block">
            {label}
          </span>
        </Link>
      )

    default:
      return (
        <button onClick={onClick} className="cursor-pointer" type="button">
          <div className="relative">
            {icon}

            {displayBadge && (
              <span className="bg-yellow-30 absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full text-xs font-bold text-white md:h-5 md:w-5">
                {displayBadge}
              </span>
            )}
          </div>
          <span className="hidden text-[clamp(0.625rem,1.2vw,0.75rem)] leading-none font-medium whitespace-nowrap md:block">
            {label}
          </span>
        </button>
      )
  }
}

function NotificationButton({
  hasDot,
  label,
}: {
  hasDot: boolean
  label: string
}) {
  return (
    <button className="relative flex cursor-pointer flex-col items-center gap-1 text-white">
      <div className="relative">
        <Bell className="h-6 w-6 md:h-8 md:w-8" color="white" />
        {hasDot && (
          <span className="bg-yellow-30 absolute -top-1 -right-1 h-2 w-2 rounded-full" />
        )}
      </div>

      <span className="hidden text-[clamp(0.625rem,1.2vw,0.75rem)] leading-none font-medium whitespace-nowrap group-hover:underline md:block">
        {label}
      </span>
    </button>
  )
}
