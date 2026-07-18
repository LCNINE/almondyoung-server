"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"

const LINKS = [
  { key: "orderList", href: "/mypage/order/list" },
  { key: "wish", href: "/mypage/wish" },
  { key: "review", href: "/mypage/reviews" },
  { key: "myInfo", href: "/mypage/account/profile" },
  { key: "cs", href: "/cs" },
] as const

export function FrequentMenu() {
  const t = useTranslations("mypage.frequent")

  return (
    <section className="flex w-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-black">{t("title")}</h2>
        <LocalizedClientLink
          href="/mypage/menu"
          className="text-primary flex items-center gap-0.5 text-xs font-medium"
        >
          {t("viewAll")}
          <ChevronRight className="h-3.5 w-3.5" />
        </LocalizedClientLink>
      </div>

      <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {LINKS.map(({ key, href }) => (
          <LocalizedClientLink
            key={key}
            href={href}
            className="hover:border-primary hover:text-primary shrink-0 rounded-md border border-gray-200 px-3.5 py-2 text-sm font-medium whitespace-nowrap text-gray-700 transition-colors"
          >
            {t(key)}
          </LocalizedClientLink>
        ))}
      </div>
    </section>
  )
}
