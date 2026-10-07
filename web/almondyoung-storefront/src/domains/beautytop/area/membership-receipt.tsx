"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getSavingsOverview } from "@/lib/api/membership"
import { formatDate } from "@/lib/utils/format-date"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useNumberFormats } from "../use-number-formats"

// Same period boundaries as the refund decision (membership savings overview).
// Loaded only when a member opens the shop tab, never on every page view.
export function MembershipReceipt() {
  const t = useTranslations("beautytop.receipt")
  const fmt = useNumberFormats()
  const overview = useQuery({
    queryKey: ["beautytop-membership-receipt"],
    queryFn: () => getSavingsOverview(),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const period = overview.data?.currentPeriod
  if (!period) return null

  return (
    <section aria-labelledby="bt-receipt" className="flex flex-col rounded-2xl bg-zinc-900 px-5 pt-5 pb-2 text-white">
      <span className="w-fit rounded-full border border-white/40 px-3 py-1 text-xs">MEMBERSHIP</span>
      <h2 id="bt-receipt" className="mt-3 text-lg font-bold">{t("title")}</h2>
      <p className="mt-1 text-[13px] text-white/60">{t("since", { date: formatDate(period.startDate) })}</p>
      <dl className="mt-3 text-sm">
        <div className="flex justify-between gap-4 border-t border-zinc-700 py-3">
          <dt className="text-white/80">{t("discount")}</dt>
          <dd className="text-primary font-bold tabular-nums">
            {period.totalSavings > 0
              ? t("discountValue", { amount: fmt.full(period.totalSavings), orders: period.orderCount })
              : t("discountNone")}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-zinc-700 py-3">
          <dt className="text-white/80">{t("beautytop")}</dt>
          <dd className="text-primary font-bold">{t("inUse")}</dd>
        </div>
      </dl>
      <LocalizedClientLink href="/mypage/membership" className="border-t border-zinc-700 py-3 text-[13px] text-white/80">
        {t("more")}
      </LocalizedClientLink>
    </section>
  )
}
