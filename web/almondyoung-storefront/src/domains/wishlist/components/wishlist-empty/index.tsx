"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { Heart } from "lucide-react"
import { useTranslations } from "next-intl"

export function WishlistEmpty() {
  const t = useTranslations("mypage.wishlist")
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <Heart className="h-8 w-8 text-gray-400" />
      </div>
      <p className="mb-2 text-lg font-medium text-gray-900">
        {t("emptyTitle")}
      </p>
      <p className="mb-6 text-sm text-gray-500">{t("emptyDescription")}</p>
      <LocalizedClientLink href="/">
        <Button variant="outline" className="h-10 px-6">
          {t("shopNow")}
        </Button>
      </LocalizedClientLink>
    </div>
  )
}
