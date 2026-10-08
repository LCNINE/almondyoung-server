"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTranslations } from "next-intl"
import { scopeLevel } from "../scope"
import { Segmented } from "./parts"
import type { BeautyTopOptions, BeautyTopRevenue } from "../types"
import { Bars, Big, Chip, Headline } from "./parts"

export { DEFAULT_FILTERS, FILTERS_KEY } from "../scope"
export type { ScopeFilters as Filters } from "../scope"
export { useScopeFilters } from "../use-scope"
import type { ScopeFilters as Filters } from "../scope"

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
  const level = scopeLevel(filters)
  const guguns = options.regions
    .filter((r) => r.sido === filters.sido)
    .map((r) => r.gugun)
  const categories = Array.from(
    new Set(options.services.map((s) => s.category))
  )

  return (
    <>
      <Segmented
        value={level}
        options={[
          { value: "national", label: t("scope.national") },
          { value: "province", label: t("scope.province") },
          { value: "district", label: t("scope.district") },
        ]}
        onChange={(next) => {
          const sido = filters.sido || sidos[0] || ""
          update(
            next === "national"
              ? { sido: "", gugun: "" }
              : {
                  sido,
                  gugun:
                    next === "district"
                      ? (options.regions.find((r) => r.sido === sido)?.gugun ??
                        "")
                      : "",
                }
          )
        }}
      />
      {level !== "national" && (
        <div className="mt-3 flex gap-2">
          <FilterSelect
            label={t("filter.sido")}
            value={filters.sido}
            options={sidos}
            onChange={(sido) =>
              update({
                sido,
                gugun:
                  level === "district"
                    ? (options.regions.find((r) => r.sido === sido)?.gugun ??
                      "")
                    : "",
              })
            }
          />
          {level === "district" && (
            <FilterSelect
              label={t("filter.gugun")}
              value={filters.gugun}
              options={guguns}
              onChange={(gugun) => update({ gugun })}
            />
          )}
        </div>
      )}
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
