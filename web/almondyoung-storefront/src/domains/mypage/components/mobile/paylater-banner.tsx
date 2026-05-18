"use client"

import { ChevronRight, CreditCard } from "lucide-react"
import { useTranslations } from "next-intl"

export default function PayLaterBanner() {
  const t = useTranslations("mypage.banner")
  return (
    <section className="relative flex w-full items-center justify-between overflow-hidden bg-[#ff9a1a] px-6 py-3 shadow-sm">
      <div className="z-10 flex flex-col gap-1">
        <h2 className="text-[21px] leading-tight font-bold text-white">
          {t("payLaterLine1")}
          <br />
          {t("payLaterLine2")}
        </h2>
      </div>

      <div className="z-10 flex items-center gap-3">
        <img
          src="caecb47a-aff1-441d-b904-7f5b4a8fc1d7-1.png"
          alt={t("payLaterImageAlt")}
          className="h-[81px] w-[81px] rounded-[10px] object-cover"
        />

        <ChevronRight
          className="h-5 w-5 text-white opacity-80"
          strokeWidth={3}
        />
      </div>

      <CreditCard
        className="pointer-events-none absolute right-[24%] bottom-[-5px] h-12 w-12 text-[#1d1e1d] opacity-10"
        aria-hidden="true"
        strokeWidth={2.5}
      />
    </section>
  )
}
