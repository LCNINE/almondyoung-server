"use client"

import { Menu } from "lucide-react"
import { useTranslations } from "next-intl"

export function CategoryDropdownTrigger() {
  const t = useTranslations("header.categoryDropdown")
  return (
    <>
      <Menu className="h-5 w-5" />
      <span className="text-sm font-medium">{t("trigger")}</span>
    </>
  )
}
