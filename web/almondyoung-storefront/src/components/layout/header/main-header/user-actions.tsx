"use client"

import { LanguageSwitcher } from "@/components/layout/header/language-switcher"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { useCart } from "@/contexts/cart-context"
import { useUser } from "@/contexts/user-context"
import { ClipboardList, ShoppingBag, User } from "lucide-react"
import { useTranslations } from "next-intl"

const ICON_CLASS_NAME = "h-6 w-6"

export function AccountMenu() {
  const { user } = useUser()
  const { itemCount: cartItemCount } = useCart()
  const t = useTranslations("account")
  const tUtility = useTranslations("header.utility")
  const cartBadge =
    cartItemCount > 0 ? (cartItemCount > 99 ? "99+" : cartItemCount) : null

  return (
    <nav
      aria-label={tUtility("menuAriaLabel")}
      className="flex items-center xl:gap-1"
    >
      {/* 서비스 줄이 숨는 모바일에서만 언어 전환을 헤더에 둔다 */}
      <LanguageSwitcher variant="iconButton" className="xl:hidden" />

      <AccountMenuItem
        href={user ? "/mypage" : "/login"}
        icon={<User className={ICON_CLASS_NAME} strokeWidth={1.8} />}
        label={user ? t("myPage") : t("login")}
      />

      <AccountMenuItem
        href="/mypage/order/list"
        icon={<ClipboardList className={ICON_CLASS_NAME} strokeWidth={1.8} />}
        label={tUtility("orderLookup")}
      />

      <AccountMenuItem
        href="/cart"
        icon={<ShoppingBag className={ICON_CLASS_NAME} strokeWidth={1.8} />}
        label={t("cart")}
        ariaLabel={
          cartBadge
            ? tUtility("cartWithCount", { count: cartItemCount })
            : undefined
        }
        badge={cartBadge}
      />
    </nav>
  )
}

interface AccountMenuItemProps {
  href: string
  icon: React.ReactNode
  label: string
  ariaLabel?: string
  badge?: number | string | null
}

function AccountMenuItem({
  href,
  icon,
  label,
  ariaLabel,
  badge,
}: AccountMenuItemProps) {
  return (
    <LocalizedClientLink
      href={href}
      aria-label={ariaLabel ?? label}
      className="hover:text-foreground relative flex min-w-9 flex-col items-center gap-0.5 px-0.5 py-1.5 text-xs text-gray-700 transition-colors xl:min-w-14 xl:px-1"
    >
      {icon}

      <span className="hidden leading-none whitespace-nowrap xl:block">
        {label}
      </span>

      {badge && (
        <span className="bg-pink text-ink absolute top-0 right-0 grid h-[18px] min-w-[18px] place-items-center rounded-full px-[5px] text-[11px] leading-none font-bold xl:right-2">
          {badge}
        </span>
      )}
    </LocalizedClientLink>
  )
}
