"use client"

import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { useScopeLabel } from "../use-scope"
import { useMemo } from "react"
import type { Filters } from "../components/neighborhood-tab"
import type { BeautyTopLifecycle, BeautyTopOptions } from "../types"
import { useArea } from "../use-area"
import { useNumberFormats } from "../use-number-formats"
import { Bars, CardSkeleton, LoadError } from "../components/parts"
import { layoutDots } from "./dot-field"
import { useMarketSummary } from "./use-market-summary"

const DOT_CLASS = {
  new: "bg-foreground",
  old: "bg-[#d1d3d8]",
  mine: "bg-primary ring-2 ring-white motion-safe:animate-pulse",
} as const

export function AreaHero({
  filters,
  mineLabel,
  options,
}: {
  filters: Filters
  mineLabel: string | null
  options: BeautyTopOptions
}) {
  const t = useTranslations("beautytop.area")
  const fmt = useNumberFormats()
  const region = useScopeLabel(filters)
  const market = useMarketSummary(filters, options)
  const lifecycle = useArea<BeautyTopLifecycle>(
    "lifecycle",
    filters,
    !!filters.sido
  )

  const shops = market.data?.shops ?? 0
  // Same response as the shop count, so the two numbers describe the same population.
  const opened = market.data?.opened_last_year ?? null
  const layout = useMemo(
    () => layoutDots(shops, opened ?? 0, true),
    [shops, opened]
  )

  // Closures are an extra line: a slow or failed lifecycle call must not hold the picture back.
  if (market.isPending) return <CardSkeleton />
  if (market.isError) return <LoadError onRetry={() => market.refetch()} />
  if (!market.data?.available || shops === 0) {
    return (
      <p className="text-muted-foreground py-6 text-[15px]">
        {t(!market.data?.available ? "regionRequired" : "empty")}
      </p>
    )
  }

  return (
    <section aria-labelledby="area-headline" className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        {layout.perDot === 1
          ? t("eyebrow", { ...filters, sido: region, gugun: "" })
          : t("eyebrowGrouped", {
              ...filters,
              sido: region,
              gugun: "",
              per: layout.perDot,
            })}
      </p>
      <h2
        id="area-headline"
        className="text-foreground text-[26px] leading-[35px] font-bold break-keep"
      >
        {t("headline", { count: fmt.full(shops), category: filters.category })}
      </h2>
      <div
        role="img"
        aria-label={
          opened === null
            ? t("dotsLabelNoOpened", { count: shops })
            : t("dotsLabel", { count: shops, opened })
        }
        className="bg-muted grid grid-cols-[repeat(22,minmax(0,1fr))] gap-1 rounded-2xl p-4"
      >
        {layout.dots.map((kind, i) => (
          <span
            key={i}
            className={cn("block aspect-square rounded-full", DOT_CLASS[kind])}
          />
        ))}
      </div>
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {opened !== null && (
          <li className="flex items-center gap-1">
            <span className="bg-foreground size-2 rounded-full" />
            {t("legendNew", { opened })}
          </li>
        )}
        <li className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-[#d1d3d8]" />
          {t("legendOld")}
        </li>
        <li className="flex items-center gap-1">
          <span className="bg-primary size-2 rounded-full" />
          {mineLabel ?? t("legendMine")}
        </li>
      </ul>
      <p className="text-muted-foreground text-sm leading-[19px] break-keep">
        {[
          !filters.sido
            ? t("nationalLifecycle")
            : lifecycle.isPending || lifecycle.isError
              ? null
              : lifecycle.data?.available &&
                  typeof lifecycle.data.closed === "number"
                ? t("closed", { closed: lifecycle.data.closed })
                : t("closedUnknown"),
          market.data.residents_per_shop
            ? t("density", {
                residents: fmt.full(Math.round(market.data.residents_per_shop)),
              })
            : null,
        ]
          .filter(Boolean)
          .join(" ")}
      </p>
      {lifecycle.data?.available &&
        (lifecycle.data.monthly?.length ?? 0) > 1 && (
          <MonthlyOpenings monthly={lifecycle.data.monthly ?? []} />
        )}
      <p className="text-muted-foreground text-xs">{t("dotNote")}</p>
      {!filters.sido && (
        <p className="text-muted-foreground text-xs">{t("nationalBasis")}</p>
      )}
    </section>
  )
}

function MonthlyOpenings({
  monthly,
}: {
  monthly: NonNullable<BeautyTopLifecycle["monthly"]>
}) {
  const t = useTranslations("beautytop")
  const label = (month: string) => month.slice(2).replace("-", ".")
  return (
    <div>
      <p className="text-foreground text-[15px] font-medium">
        {t("market.chartTitle")}
      </p>
      <Bars
        values={monthly.map((m) => m.opened)}
        firstLabel={label(monthly[0].month)}
        lastLabel={label(monthly[monthly.length - 1].month)}
        lastAnnotation={`+${monthly[monthly.length - 1].opened}`}
      />
    </div>
  )
}
