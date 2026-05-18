"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Eye, Heart, Package, ShoppingBag } from "lucide-react"
import { useTranslations } from "next-intl"
import React from "react"

interface QuickMenuItemProps {
  icon: React.ReactNode
  label: string
  href: string
}

function QuickMenuItem({ icon, label, href }: QuickMenuItemProps) {
  return (
    <LocalizedClientLink
      href={href}
      className="group flex flex-1 flex-col items-center justify-center gap-[6px]"
    >
      <div className="relative h-[27px] w-[27px]">{icon}</div>
      <span className="text-center font-['Pretendard'] text-xs whitespace-nowrap text-black">
        {label}
      </span>
    </LocalizedClientLink>
  )
}

export function QuickLinks() {
  const t = useTranslations("mypage.quickLink")

  return (
    <nav
      className="flex w-full items-center justify-between rounded-[10px] bg-white py-[15px] shadow-sm"
      aria-label={t("orderList")}
    >
      <QuickMenuItem
        label={t("orderList")}
        icon={<Package size={27} className="text-amber-500" />}
        href="/mypage/order/list"
      />
      <QuickMenuItem
        label={t("wish")}
        icon={<Heart size={27} className="text-amber-500" />}
        href="/mypage/wish"
      />
      <QuickMenuItem
        label={t("rebuy")}
        icon={<ShoppingBag size={27} className="text-amber-500" />}
        href="/mypage/rebuy"
      />
      <QuickMenuItem
        label={t("recent")}
        icon={<Eye size={27} className="text-amber-500" />}
        href="/mypage/recent"
      />
    </nav>
  )
}
