"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Crown, Settings } from "lucide-react"
import { useTranslations } from "next-intl"

interface MobileHeaderProps {
  userName: string
  isMembership: boolean
}

export function MobileHeader({ userName, isMembership }: MobileHeaderProps) {
  const t = useTranslations("mypage.profile")

  return (
    <header className="flex items-center justify-between">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">
            {userName} {t("honorific")}
          </h1>
          {isMembership ? (
            <LocalizedClientLink href="/mypage/membership">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">
                <Crown className="h-3 w-3" />
                {t("membershipMember")}
              </span>
            </LocalizedClientLink>
          ) : (
            <LocalizedClientLink href="/mypage/membership/subscribe/payment">
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">
                <Crown className="h-3 w-3" />
                {t("membershipJoinShort")}
              </span>
            </LocalizedClientLink>
          )}
        </div>
        <LocalizedClientLink href="/mypage/account/profile">
          <button aria-label={t("settings")}>
            <Settings className="h-6 w-6" />
          </button>
        </LocalizedClientLink>
      </div>
    </header>
  )
}
