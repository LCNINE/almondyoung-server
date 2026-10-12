"use client"

import { useUser } from "@/contexts/user-context"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getSavingsOverview } from "@/lib/api/membership"
import { formatDate } from "@/lib/utils/format-date"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useNumberFormats } from "../use-number-formats"
import { CardSkeleton } from "../components/parts"

// Same period boundaries as the refund decision (membership savings overview).
// Loaded only when a member opens the shop tab, never on every page view.
export function MembershipReceipt() {
  const { user } = useUser()
  const t = useTranslations("beautytop.receipt")
  const insight = useTranslations("beautytop.insights")
  const fmt = useNumberFormats()
  const overview = useQuery({
    queryKey: ["beautytop-membership-receipt", user?.id],
    queryFn: () => getSavingsOverview(),
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const period = overview.data?.currentPeriod
  if (user && overview.isPending) return <CardSkeleton />
  if (!period) return null

  return (
    <section
      aria-labelledby="bt-receipt"
      className="bg-foreground text-background flex flex-col rounded-xl px-4 pt-4 pb-2"
    >
      <span className="border-background/40 w-fit rounded-full border px-3 py-1 text-xs">
        {insight("memberLabel")}
      </span>
      <h2 id="bt-receipt" className="mt-3 text-lg font-bold">
        {t("title")}
      </h2>
      <p className="text-background/70 mt-1 text-[13px]">
        {t("since", { date: formatDate(period.startDate) })}
      </p>
      <dl className="mt-3 text-sm">
        <div className="border-background/20 flex justify-between gap-4 border-t py-3">
          <dt className="text-background/80">{t("discount")}</dt>
          <dd className="text-background font-bold tabular-nums">
            {period.totalSavings > 0
              ? t("discountValue", {
                  amount: fmt.full(period.totalSavings),
                  orders: period.orderCount,
                })
              : t("discountNone")}
          </dd>
        </div>
        <div className="border-background/20 flex justify-between gap-4 border-t py-3">
          <dt className="text-background/80">{t("beautytop")}</dt>
          <dd className="text-background font-bold">{t("inUse")}</dd>
        </div>
      </dl>
      <LocalizedClientLink
        href="/mypage/membership"
        className="border-background/20 text-background/80 border-t py-3 text-[13px]"
      >
        {t("more")}
      </LocalizedClientLink>
    </section>
  )
}
