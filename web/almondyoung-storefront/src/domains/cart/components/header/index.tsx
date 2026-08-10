"use client"

import React from "react"
import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { useParams } from "next/navigation"
import { BackButton } from "@/components/shared/back-button"

export function CartHeader() {
  const t = useTranslations("cart.header")
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"

  return (
    <div className="hidden md:block">
      <div className="flex items-center justify-between py-10">
        <div className="flex items-center gap-3">
          <BackButton
            fallbackHref={`/${countryCode}`}
            className="h-10 w-10 border border-gray-200 bg-white hover:border-gray-300"
            iconClassName="h-5 w-5"
          />
          <h1 className="text-4xl font-bold">{t("title")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold">{t("stepCheckout")}</span>
          <ChevronRight className="text-border h-6 w-6" />
          <span className="text-muted-foreground text-xl font-normal">
            {t("stepDone")}
          </span>
        </div>
      </div>
    </div>
  )
}
