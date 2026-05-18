"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { ShoppingBag } from "lucide-react"
import { useTranslations } from "next-intl"

export function FrequentEmpty() {
  const t = useTranslations("mypage.frequentProducts")
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <ShoppingBag className="h-8 w-8 text-gray-400" />
      </div>
      <h3 className="mb-2 text-lg font-medium text-gray-900">
        {t("emptyTitle")}
      </h3>
      <p className="mb-6 text-center text-sm text-gray-500">
        {t("emptyDescription")}
      </p>
      <LocalizedClientLink href="/categories">
        <Button variant="outline">{t("shopNow")}</Button>
      </LocalizedClientLink>
    </div>
  )
}
