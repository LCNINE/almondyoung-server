"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  OPENING_SIDO,
  isOpeningArea,
  openingPath,
} from "@/lib/beautytop/opening-areas"
import { useTranslations } from "next-intl"
import { useScopeLabel } from "../use-scope"
import { useState } from "react"
import {
  type Filters,
  RevenueCard,
  ScopeFilters,
  useScopeFilters,
} from "../components/neighborhood-tab"
import { CardSkeleton, LoadError } from "../components/parts"
import { Trends } from "../components/trends-tab"
import type { BeautyTopOptions, BeautyTopRevenue } from "../types"
import { useArea } from "../use-area"
import { AreaCompare } from "./area-compare"
import { AreaHero } from "./area-hero"
import { PriceRuler } from "./price-ruler"
import { ShareCard } from "./share-card"

function AreaRevenue({ filters }: { filters: Filters }) {
  const t = useTranslations("beautytop")
  const region = useScopeLabel(filters)
  const revenue = useArea<BeautyTopRevenue>("revenue", filters)
  const group = revenue.data?.available ? revenue.data.groups?.[0] : undefined
  if (revenue.isPending)
    return (
      <>
        <Divider />
        <CardSkeleton variant="chart" />
      </>
    )
  if (revenue.isError)
    return (
      <>
        <Divider />
        <LoadError onRetry={() => revenue.refetch()} />
      </>
    )
  if (!group || group.series.length < 2) return null
  return (
    <>
      <Divider />
      <section className="flex flex-col gap-2">
        <RevenueCard group={group} region={region} />
        <p className="text-muted-foreground text-xs">{t("revenue.note")}</p>
      </section>
    </>
  )
}

function Divider() {
  return <div className="bg-secondary -mx-4 h-2" />
}

/** The neighbourhood screen everyone gets — aggregates only, all from the shared server cache. */
export function AreaView({
  mineLabel,
  shopSlot,
}: {
  mineLabel: string | null
  shopSlot?: (filters: Filters) => React.ReactNode
}) {
  const t = useTranslations("beautytop")
  const options = useArea<BeautyTopOptions>("options")
  const [filters, update] = useScopeFilters()
  const [wideTrends, setWideTrends] = useState(false)
  const scopeKey = `${filters.sido}:${filters.gugun}:${filters.category}`
  const trendFilters: Filters = wideTrends ? { ...filters, gugun: "" } : filters

  if (options.isPending) return <CardSkeleton />
  if (options.isError) return <LoadError onRetry={() => options.refetch()} />

  return (
    <div className="bg-background -mx-4 flex flex-col gap-6 px-4 py-6">
      <ScopeFilters
        options={options.data}
        filters={filters}
        onChange={(next) => {
          setWideTrends(false)
          update(next)
        }}
      />
      <AreaHero
        key={`h:${scopeKey}`}
        filters={filters}
        mineLabel={mineLabel}
        options={options.data}
      />
      {shopSlot && (
        <>
          <Divider />
          {shopSlot(filters)}
        </>
      )}
      <Divider />
      <PriceRuler key={`p:${scopeKey}`} filters={filters} />
      <AreaRevenue key={`r:${scopeKey}`} filters={filters} />
      <Divider />
      <AreaCompare
        key={`c:${scopeKey}`}
        options={options.data}
        filters={filters}
      />
      <Divider />
      <section aria-labelledby="insta-title" className="flex flex-col gap-3">
        <h2 id="insta-title" className="text-lg font-bold">
          {t("insta.title")}
        </h2>
        <Trends
          key={JSON.stringify(trendFilters)}
          filters={trendFilters}
          onWiden={() => setWideTrends(true)}
        />
      </section>
      <Divider />
      <ShareCard
        key={`s:${scopeKey}`}
        filters={filters}
        options={options.data}
      />
      {filters.sido === OPENING_SIDO &&
        isOpeningArea(filters.gugun, filters.category) && (
          <LocalizedClientLink
            href={openingPath(filters.gugun, filters.category)}
            className="text-foreground w-fit text-sm underline underline-offset-4 transition-colors duration-150 hover:opacity-80"
          >
            {t("opening.fromArea")} →
          </LocalizedClientLink>
        )}
    </div>
  )
}
