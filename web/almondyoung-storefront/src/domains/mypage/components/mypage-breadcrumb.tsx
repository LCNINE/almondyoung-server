"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
    <Breadcrumb className="mb-4 hidden md:block lg:hidden">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <LocalizedClientLink href="/mypage">
              {t("mypage.menu.home")}
            </LocalizedClientLink>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{t(currentLabelKey)}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
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
