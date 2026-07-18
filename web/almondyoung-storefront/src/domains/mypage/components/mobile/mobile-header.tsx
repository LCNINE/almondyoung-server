"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { ChevronRight, Crown, Settings, User } from "lucide-react"
import { useTranslations } from "next-intl"

interface MobileHeaderProps {
  userName: string
  isMembership: boolean
  pointAvailable: number
}

export function MobileHeader({
  userName,
  isMembership,
  pointAvailable,
}: MobileHeaderProps) {
  const t = useTranslations("mypage")

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between text-white">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white">
            <User className="text-primary h-5 w-5" />
          </div>
          <h1 className="text-xl font-bold">
            {userName} {t("profile.honorific")}
          </h1>
        </div>
        <LocalizedClientLink href="/mypage/account/profile">
          <button aria-label={t("profile.settings")}>
            <Settings className="h-6 w-6" />
          </button>
        </LocalizedClientLink>
      </header>

      {/* 멤버십 카드 */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <LocalizedClientLink
          href={
            isMembership
              ? "/mypage/membership"
              : "/mypage/membership/subscribe/payment"
          }
        >
          <div
            className={cn(
              "flex items-center",
              isMembership ? "gap-2" : "justify-between"
            )}
          >
            <span className="flex items-baseline gap-1">
              <span className="text-lg font-extrabold text-primary">멤버십</span>
            </span>
            {isMembership ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                <Crown className="h-3 w-3" />
                {t("profile.benefitActive")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-gray-500">
                {t("profile.membershipJoinCta")}
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        </LocalizedClientLink>

        <div className="mt-3 border-t border-gray-100 pt-3">
          <LocalizedClientLink
            href="/mypage/point"
            className="flex items-center justify-between"
          >
            <span className="text-sm text-gray-500">
              {t("banner.pointLabel")}
            </span>
            <span className="flex items-center gap-1">
              <span className="text-base font-bold">
                {pointAvailable.toLocaleString()}
                {t("profile.won")}
              </span>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </span>
          </LocalizedClientLink>
        </div>
      </div>
    </div>
  )
}
