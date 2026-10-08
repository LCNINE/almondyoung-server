"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { useScopeLabel } from "../use-scope"
import { scopeLevel } from "../scope"
import type { Filters } from "../components/neighborhood-tab"
import type {
  BeautyTopMarket,
  BeautyTopOptions,
  BeautyTopPrice,
} from "../types"
import { useArea } from "../use-area"
import { useNumberFormats } from "../use-number-formats"

type Column = { market?: BeautyTopMarket; prices?: BeautyTopPrice }

// The second column loads only after a district is picked: two cached calls, none before.
function useColumn(filters: Filters | null): Column {
  const params = filters ?? { sido: "", gugun: "", category: "" }
  const enabled = !!filters
  return {
    market: useArea<BeautyTopMarket>("market", params, enabled).data,
    prices: useArea<BeautyTopPrice>("prices", params, enabled).data,
  }
}

export function AreaCompare({
  options,
  filters,
}: {
  options: BeautyTopOptions
  filters: Filters
}) {
  const t = useTranslations("beautytop.compare")
  const fmt = useNumberFormats()
  const region = useScopeLabel(filters)
  const scope = useTranslations("beautytop.scope")
  const [other, setOther] = useState<string | null>(null)
  const choices = [
    ...(filters.sido
      ? [
          {
            id: "national",
            label: scope("national"),
            filters: { ...filters, sido: "", gugun: "" },
          },
        ]
      : []),
    ...(filters.gugun
      ? [
          {
            id: "province",
            label: filters.sido,
            filters: { ...filters, gugun: "" },
          },
        ]
      : []),
    ...(scopeLevel(filters) === "district"
      ? options.regions
          .filter((r) => r.sido === filters.sido && r.gugun !== filters.gugun)
          .map((r) => ({
            id: r.gugun,
            label: r.gugun,
            filters: { ...filters, gugun: r.gugun },
          }))
      : Array.from(new Set(options.regions.map((r) => r.sido)))
          .filter((sido) => sido !== filters.sido)
          .map((sido) => ({
            id: sido,
            label: sido,
            filters: { ...filters, sido, gugun: "" },
          }))),
  ]
  const selected = choices.find((c) => c.id === other)
  const left = useColumn(filters)
  const right = useColumn(selected?.filters ?? null)

  const service = left.prices?.groups?.find((g) => typeof g.median === "number")
  const medianOf = (c: Column) =>
    c.prices?.groups?.find((g) => g.service_id === service?.service_id)?.median
  const cell = (
    value: number | null | undefined,
    unit: "shops" | "people" | "won"
  ) =>
    value == null
      ? "—"
      : t(`unit.${unit}`, { value: fmt.full(Math.round(value)) })

  const rows = [
    {
      key: "shops",
      l: cell(left.market?.shops, "shops"),
      r: cell(right.market?.shops, "shops"),
    },
    {
      key: "residents",
      l: cell(left.market?.residents_per_shop, "people"),
      r: cell(right.market?.residents_per_shop, "people"),
    },
    // Same response as the shop count (permits do not separate every category).
    {
      key: "opened",
      l: cell(left.market?.opened_last_year, "shops"),
      r: cell(right.market?.opened_last_year, "shops"),
    },
    ...(service
      ? [
          {
            key: "price",
            l: cell(medianOf(left), "won"),
            r: cell(medianOf(right), "won"),
          },
        ]
      : []),
  ]

  return (
    <section aria-labelledby="compare-title" className="flex flex-col gap-4">
      <h2 id="compare-title" className="text-lg font-bold break-keep">
        {t("title")}
      </h2>
      <table className="border-border w-full table-fixed overflow-hidden rounded-xl border text-sm">
        <thead className="bg-muted">
          <tr>
            <th scope="col" className="w-24 p-3">
              <span className="sr-only">{t("metric")}</span>
            </th>
            <th scope="col" className="p-3 text-left font-bold">
              {region}
            </th>
            <th scope="col" className="p-2 text-left">
              <Select value={other ?? undefined} onValueChange={setOther}>
                <SelectTrigger
                  aria-label={t("pick")}
                  className="h-9 border-0 bg-transparent px-1 font-bold shadow-none"
                >
                  <SelectValue placeholder={t("pick")} />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((choice) => (
                    <SelectItem key={choice.id} value={choice.id}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-border border-t">
              <th
                scope="row"
                className="text-muted-foreground p-3 text-left font-normal"
              >
                {row.key === "price"
                  ? t("row.price", { name: service?.name ?? "" })
                  : t(`row.${row.key}`)}
              </th>
              <td className="p-3 tabular-nums">{row.l}</td>
              <td className="p-3 tabular-nums">
                {other ? (
                  row.r
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground text-xs">{t("note")}</p>
    </section>
  )
}
