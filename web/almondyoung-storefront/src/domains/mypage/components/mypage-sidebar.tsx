"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { usePathname } from "next/navigation"

import { SIDEBAR_SECTIONS } from "./constants/mypage-constants"

export default function MypageSidebar({
  className = "",
}: {
  className?: string
}) {
  const t = useTranslations()
  const pathname = usePathname()
  const normalizedPathname = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/")

  // 경로가 메뉴 path 에 매칭되면 그 길이를, 아니면 -1. (긴 매칭일수록 더 구체적)
  const matchLen = (path: string): number => {
    if (path === "/mypage") return normalizedPathname === path ? path.length : -1
    return normalizedPathname === path ||
      normalizedPathname.startsWith(`${path}/`)
      ? path.length
      : -1
  }

  // 여러 메뉴가 prefix 로 겹칠 때(예: /mypage/membership 와
  // /mypage/membership/payment-method) 가장 구체적인 항목 하나만 활성 처리.
  const activePath = SIDEBAR_SECTIONS.flatMap((section) => section.items).reduce(
    (best, item) => {
      const len = matchLen(item.path)
      return len > best.len ? { path: item.path, len } : best
    },
    { path: "", len: -1 }
  ).path

  const isActive = (path: string) => path !== "" && path === activePath

  return (
    <nav
      className={cn("hidden md:block", className)}
      aria-label={t("mypage.menu.mypage")}
    >
      <LocalizedClientLink
        href="/mypage"
        className="block pb-2 text-2xl font-bold text-gray-900"
      >
        {t("mypage.menu.mypage")}
      </LocalizedClientLink>

      {SIDEBAR_SECTIONS.map((section) => (
        <div
          key={section.title}
          className="py-5 border-b border-gray-200 last:border-b-0"
        >
          <h3 className="text-[15px] font-bold text-gray-900">
            {t(section.title)}
          </h3>
          <ul className="mt-3 space-y-3">
            {section.items.map((item) => (
              <li key={item.id}>
                <LocalizedClientLink
                  href={item.path}
                  className={cn(
                    "text-[13px] transition-colors",
                    isActive(item.path)
                      ? "text-yellow-30 font-semibold"
                      : "hover:text-yellow-30 text-gray-600"
                  )}
                >
                  {t(item.label)}
                </LocalizedClientLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
