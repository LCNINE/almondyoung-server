"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ChevronRight, Crown, User } from "lucide-react"
import { useTranslations } from "next-intl"

interface UserProfileSectionProps {
  userName: string
  initialPointBalance: number
  isMembership: boolean
  /** 보유 쿠폰 수 (데이터 연결 전까지 0) */
  couponCount?: number
}

export function UserProfileSection({
  userName,
  initialPointBalance,
  isMembership,
  couponCount = 0,
}: UserProfileSectionProps) {
  const t = useTranslations("mypage.profile")
  const tMenu = useTranslations("mypage.menu")

  return (
    <section
      aria-label={t("ariaLabel")}
      className="mb-6 overflow-hidden rounded-xl border border-gray-100"
    >
      {/* 상단: 아바타 + 이름 + 오독 멤버십 */}
      <div className="bg-primary flex flex-wrap items-center gap-3 p-5 sm:gap-4 sm:p-6">
        <div
          className="grid size-10 place-items-center rounded-full bg-white shadow-sm"
          aria-hidden
        >
          <User className="text-primary size-6" />
        </div>
        <strong className="flex items-center gap-1 font-normal whitespace-nowrap">
          <span className="text-lg font-bold text-white">{userName}</span>
          <span className="text-lg text-white/80">{t("honorific")}</span>
        </strong>

        {/* 오독(ODOK) 멤버십 뱃지 */}
        <LocalizedClientLink
          href={
            isMembership
              ? "/mypage/membership"
              : "/mypage/membership/subscribe/payment"
          }
        >
          <span className="ring-primary/15 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1 whitespace-nowrap shadow-sm ring-1 transition-colors hover:bg-gray-50">
            <span className="text-primary text-base font-extrabold">오독</span>
            <span className="text-primary/70 text-[10px] font-bold tracking-wide">
              ODOK
            </span>
            {isMembership ? (
              <span className="text-primary flex items-center gap-0.5 text-sm font-bold">
                <Crown className="size-3.5" aria-hidden />
                {t("benefitActive")}
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-sm font-semibold text-gray-500">
                {t("membershipJoinCta")}
                <ChevronRight className="size-3.5" />
              </span>
            )}
          </span>
        </LocalizedClientLink>
      </div>

      {/* 하단: 포인트 | 쿠폰 통계바 */}
      <div className="flex divide-x divide-gray-100 bg-white">
        <LocalizedClientLink
          href="/mypage/point"
          className="flex flex-1 items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50"
        >
          <span className="text-sm text-gray-500">{tMenu("point")}</span>
          <span className="flex items-center gap-1 font-bold text-black">
            {initialPointBalance.toLocaleString()}
            {t("won")}
            <ChevronRight className="size-4 text-gray-400" />
          </span>
        </LocalizedClientLink>
        <LocalizedClientLink
          href="/mypage/coupons"
          className="flex flex-1 items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50"
        >
          <span className="text-sm text-gray-500">{tMenu("coupon")}</span>
          <span className="flex items-center gap-1 font-bold text-black">
            {couponCount}개
            <ChevronRight className="size-4 text-gray-400" />
          </span>
        </LocalizedClientLink>
      </div>
    </section>
  )
}
