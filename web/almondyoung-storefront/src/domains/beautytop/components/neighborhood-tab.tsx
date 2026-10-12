"use client"

import { revenuePeriod } from "./revenue-period"
import { useNumberFormats } from "../use-number-formats"

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
  const history = group.series
    .filter((point) => Number.isFinite(point.sales_won) && point.sales_won >= 0)
    .sort((a, b) => a.period.localeCompare(b.period))
  const series = history.slice(-8)
  const yoy =
    typeof group.yoy_percent === "number" && Number.isFinite(group.yoy_percent)
      ? group.yoy_percent
      : null
  const annual = revenuePeriod(group.period).kind === "year"
  const fmt = useNumberFormats()
  const periodLabel = (period: string) => {
    const parsed = revenuePeriod(period)
    return parsed.kind === "year"
      ? t("revenue.year", { year: parsed.year })
      : parsed.kind === "quarter"
        ? t("revenue.quarter", { year: parsed.year, q: parsed.quarter })
        : period
  }
  const b = (chunks: React.ReactNode) => <Big>{chunks}</Big>

  return (
    <>
      <Headline
        eyebrow={t(annual ? "revenue.annualEyebrow" : "revenue.eyebrow", {
          region,
          industry: group.industry,
        })}
      >
        {yoy == null
          ? t("revenue.changeUnknown")
          : yoy === 0
            ? t.rich(annual ? "revenue.yearFlat" : "revenue.flat", { b })
            : t.rich(
                annual
                  ? yoy > 0
                    ? "revenue.yearUp"
                    : "revenue.yearDown"
                  : yoy > 0
                    ? "revenue.up"
                    : "revenue.down",
                {
                  pct: fmt.full(Math.abs(yoy)),
                  b,
                }
              )}
      </Headline>
      {annual && (
        <dl className="mt-4 space-y-3 text-sm">
          {typeof group.average_won === "number" &&
            Number.isFinite(group.average_won) && (
              <div className="flex flex-wrap justify-between gap-2">
                <dt>{t("revenue.averageAnnual")}</dt>
                <dd className="font-bold">
                  {t("unit.won", {
                    value: fmt.full(Math.round(group.average_won)),
                  })}
                </dd>
              </div>
            )}
          {typeof group.establishments === "number" && (
            <div className="flex justify-between gap-4">
              <dt>{t("revenue.establishments")}</dt>
              <dd>{fmt.full(group.establishments)}</dd>
            </div>
          )}
          {typeof group.workers === "number" && (
            <div className="flex justify-between gap-4">
              <dt>{t("revenue.workers")}</dt>
              <dd>{fmt.full(group.workers)}</dd>
            </div>
          )}
        </dl>
      )}
      {series.length > 1 ? (
        <Bars
          values={series.map((s) => s.sales_won)}
          firstLabel={periodLabel(series[0].period)}
          lastLabel={periodLabel(series[series.length - 1].period)}
        />
      ) : (
        <p className="text-muted-foreground mt-3 text-xs">
          {periodLabel(group.period)}
        </p>
      )}
      {history.length > 0 && (
        <details className="mt-4">
          <summary className="text-foreground cursor-pointer text-sm font-medium">
            {t("revenue.history")}
          </summary>
          <table className="mt-3 w-full table-fixed text-sm">
            <caption className="sr-only">{t("revenue.estimatedSales")}</caption>
            <thead>
              <tr className="border-border border-b">
                <th scope="col" className="w-24 py-2 text-left font-medium">
                  {t("revenue.referencePeriod")}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t("revenue.estimatedSales")}
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((point) => (
                <tr key={point.period} className="border-border border-b">
                  <th scope="row" className="py-2 text-left font-normal">
                    {periodLabel(point.period)}
                  </th>
                  <td className="py-2 text-right break-words tabular-nums">
                    {t("unit.won", { value: fmt.full(point.sales_won) })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
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
