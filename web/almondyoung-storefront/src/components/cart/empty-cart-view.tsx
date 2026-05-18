"use client"

import { useTranslations } from "next-intl"
import LocalizedClientLink from "../shared/localized-client-link"

interface EmptyCartViewProps {
  showHeader?: boolean
  bgColor?: string
}

export function EmptyCartView({
  showHeader = true,
  bgColor = "bg-white",
}: EmptyCartViewProps) {
  const t = useTranslations("cart")

  return (
    <div className={`flex w-full flex-col ${bgColor}`}>
      {showHeader && (
        <header className="border-border bg-foreground w-full border-b">
          <div className="container mx-auto flex h-14 items-center px-4">
            <span className="text-background text-lg font-bold tracking-tight">
              ALMOND YOUNG
            </span>
          </div>
        </header>
      )}

      <main className="flex flex-1 flex-col items-center justify-start px-4 pt-24 sm:px-6 sm:pt-32">
        <div className="flex w-full max-w-md flex-col items-center">
          <h1 className="mb-3 text-center text-[24px] leading-snug font-semibold tracking-tight text-gray-900 sm:text-[28px] lg:text-[32px]">
            {t("emptyTitle")}
          </h1>
          <p className="mb-8 text-center text-[15px] text-gray-500 sm:mb-10 sm:text-[17px]">
            {t("emptyDescription")}
          </p>

          <LocalizedClientLink
            href={"/category/beseuteu"}
            className="rounded-xl bg-[#F29219] px-10 py-4 text-center text-[15px] font-semibold text-white transition-all hover:bg-[#E08510] sm:w-auto sm:text-[17px]"
          >
            {t("shopNow")}
          </LocalizedClientLink>
        </div>
      </main>
    </div>
  )
}
