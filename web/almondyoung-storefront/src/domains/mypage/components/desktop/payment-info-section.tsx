"use client"

import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type { BillingInfo } from "../../types/mypage-types"

interface PaymentInfoSectionProps {
  initialBillingInfo: BillingInfo | null
}

export function PaymentInfoSection({
  initialBillingInfo,
}: PaymentInfoSectionProps) {
  const t = useTranslations("mypage.billingInfo")
  if (!initialBillingInfo) {
    return null
  }

  const fmt = (d?: string | null) => formatDate(d, DATE_FORMATS.KO_DOT, "-")

  return (
    <LocalizedClientLink href="/mypage/membership">
      <section className="self-stretch bg-white transition-opacity hover:opacity-80">
        <div className="flex flex-col items-center justify-center gap-4 py-6 pl-7">
          <h2 className="text-Labels-Primary text-lg font-bold">
            {t("currentBilling")}
          </h2>

          <>
            {initialBillingInfo.nextBillingDate && (
              <p className="text-sm font-normal text-black">
                {t("scheduledOn", { date: fmt(initialBillingInfo.nextBillingDate) })}
              </p>
            )}

            <p className="inline-flex items-center justify-center gap-1">
              <span className="text-lg font-bold text-black">
                {initialBillingInfo.nextBillingAmount.toLocaleString()}
              </span>
              <span className="text-sm font-normal text-black">{t("won")}</span>

              <ChevronRight className="h-5 w-5 text-black" />
            </p>
          </>

          {initialBillingInfo.periodStart && initialBillingInfo.periodEnd && (
            <dl className="bg-gray-background inline-flex items-start justify-start gap-7 rounded-[5px] px-3.5 py-1.5">
              <dt className="text-sm font-normal text-black">{t("periodLabel")}</dt>
              <dd className="text-sm font-normal text-black">
                {fmt(initialBillingInfo.periodStart)} ~ {fmt(initialBillingInfo.periodEnd)}
              </dd>
            </dl>
          )}
        </div>
      </section>
    </LocalizedClientLink>
  )
}
