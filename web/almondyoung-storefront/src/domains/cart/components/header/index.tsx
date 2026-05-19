"use client"

import React from "react"
import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"

export function CartHeader() {
  const t = useTranslations("cart.header")

  return (
    <div className="hidden md:block">
      <div className="flex items-center justify-between py-10">
        <h1 className="text-4xl font-bold">{t("title")}</h1>
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
