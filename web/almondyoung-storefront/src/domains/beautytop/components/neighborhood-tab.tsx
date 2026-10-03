"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import type { BeautyTopOptions, BeautyTopRevenue } from "../types"
import { Bars, Big, Chip, Headline } from "./parts"

export const FILTERS_KEY = "beautytop:filters"
export const DEFAULT_FILTERS = {
  sido: "서울",
  gugun: "강남구",
  category: "속눈썹",
}

export type Filters = typeof DEFAULT_FILTERS

export function useScopeFilters() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)

  useEffect(() => {
    // A shared card links here with the area in the query: it wins over the saved choice.
    const query = new URLSearchParams(window.location.search)
    const linked = { sido: query.get("sido") ?? "", gugun: query.get("gugun") ?? "", category: query.get("category") ?? "" }
    if (linked.sido && linked.gugun && linked.category && Object.values(linked).every((v) => v.length <= 40)) {
      setFilters(linked)
      return
    }
    try {
      const saved = localStorage.getItem(FILTERS_KEY)
      if (saved) setFilters({ ...DEFAULT_FILTERS, ...JSON.parse(saved) })
    } catch {}
  }, [])

  const update = (next: Partial<Filters>) => {
    setFilters((prev) => {
      const merged = { ...prev, ...next }
      try {
        localStorage.setItem(FILTERS_KEY, JSON.stringify(merged))
      } catch {}
      return merged
    })
  }

  return [filters, update] as const
}

export function ScopeFilters({
  options,
  filters,
  onChange: update,
}: {
  options: BeautyTopOptions
  filters: Filters
  onChange: (next: Partial<Filters>) => void
}) {
  const t = useTranslations("beautytop")
  const sidos = Array.from(new Set(options.regions.map((r) => r.sido)))
  const guguns = options.regions
    .filter((r) => r.sido === filters.sido)
    .map((r) => r.gugun)
  const categories = Array.from(
    new Set(options.services.map((s) => s.category))
  )

  return (
    <>
      <div className="flex gap-2">
        <FilterSelect
          label={t("filter.sido")}
          value={filters.sido}
          options={sidos}
          onChange={(sido) =>
            update({
              sido,
              gugun: options.regions.find((r) => r.sido === sido)?.gugun ?? "",
            })
          }
        />
        <FilterSelect
          label={t("filter.gugun")}
          value={filters.gugun}
          options={guguns}
          onChange={(gugun) => update({ gugun })}
        />
      </div>
      <div
        aria-label={t("filter.category")}
        className="scrollbar-hide -mx-4 mt-3 flex gap-2 overflow-x-auto px-4"
      >
        {categories.map((category) => (
          <Chip
            key={category}
            active={filters.category === category}
            onClick={() => update({ category })}
            onCanvas
          >
            {category}
          </Chip>
        ))}
      </div>
    </>
  )
}

export function RevenueCard({
  group,
  region,
}: {
  group: NonNullable<BeautyTopRevenue["groups"]>[number]
  region: string
}) {
  const t = useTranslations("beautytop")
  const series = group.series.slice(-8)
  const yoy = group.yoy_percent
  const quarter = (period: string) =>
    t("revenue.quarter", { year: period.slice(2, 4), q: period.slice(4) })
  const b = (chunks: React.ReactNode) => <Big>{chunks}</Big>

  return (
    <>
      <Headline
        eyebrow={t("revenue.eyebrow", { region, industry: group.industry })}
      >
        {yoy == null || Math.abs(yoy) < 1
          ? t.rich("revenue.flat", { b })
          : t.rich(yoy > 0 ? "revenue.up" : "revenue.down", {
              pct: Math.abs(yoy).toFixed(1),
              b,
            })}
      </Headline>
      <Bars
        values={series.map((s) => s.sales_won)}
        firstLabel={quarter(series[0].period)}
        lastLabel={quarter(series[series.length - 1].period)}
      />
    </>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <Select
      value={options.includes(value) ? value : undefined}
      onValueChange={onChange}
    >
      <SelectTrigger
        aria-label={label}
        className="bg-background h-11 flex-1 rounded-xl border-0 text-[17px] leading-[25.5px] font-medium"
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
