"use client"

import { Menu } from "lucide-react"
import { useTranslations } from "next-intl"

export function CategoryDropdownTrigger({
  variant = "header",
}: {
  variant?: "header" | "quickLink"
}) {
  const t = useTranslations("header.categoryDropdown")

  if (variant === "quickLink") {
    return (
      <>
        <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-gray-100 bg-[#4f4a44] text-white shadow-sm transition-transform group-hover/trigger:-translate-y-0.5 group-data-[state=open]/trigger:-translate-y-0.5">
          <Menu className="h-8 w-8" />
        </span>
        <span className="line-clamp-2 min-h-[2.4em] text-center text-[12px] leading-tight font-semibold text-gray-700 md:text-[13px]">
          전체 카테고리
        </span>
      </>
    )
  }

  return (
    <>
      <Menu className="h-5 w-5" />
      <span className="text-sm font-medium">{t("trigger")}</span>
    </>
  )
}
