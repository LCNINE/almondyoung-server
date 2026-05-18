"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { usePathname } from "next/navigation"
import { SIDEBAR_MENU_ITEMS } from "./constants/mypage-constants"

export function MypageBreadcrumb() {
  const t = useTranslations()
  const pathname = usePathname()
  const normalizedPath = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/")

  // 마이페이지 홈이면 브레드크럼 불필요
  if (normalizedPath === "/mypage") return null

  const currentLabelKey = findLabelKey(normalizedPath)
  if (!currentLabelKey) return null

  return (
    <nav aria-label={t("mypage.menu.home")} className="mb-4 hidden md:block lg:hidden">
      <ol className="flex items-center gap-1 text-sm">
        <li>
          <LocalizedClientLink
            href="/mypage"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("mypage.menu.home")}
          </LocalizedClientLink>
        </li>
        <li>
          <ChevronRight className="text-muted-foreground h-3.5 w-3.5" />
        </li>
        <li>
          <span className="text-foreground font-medium">{t(currentLabelKey)}</span>
        </li>
      </ol>
    </nav>
  )
}

function findLabelKey(path: string): string | null {
  for (const item of SIDEBAR_MENU_ITEMS) {
    if (item.path === path) return item.label

    if (item.subItems) {
      for (const sub of item.subItems) {
        if (sub.path === path) return sub.label
      }
    }
  }
  return null
}
