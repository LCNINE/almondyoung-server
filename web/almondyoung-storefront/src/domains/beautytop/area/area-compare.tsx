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
import type { Filters } from "../components/neighborhood-tab"
import type { BeautyTopMarket, BeautyTopOptions, BeautyTopPrice } from "../types"
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

export function AreaCompare({ options, filters }: { options: BeautyTopOptions; filters: Filters }) {
  const t = useTranslations("beautytop.compare")
  const fmt = useNumberFormats()
  const [other, setOther] = useState<string | null>(null)
  const guguns = options.regions.filter((r) => r.sido === filters.sido && r.gugun !== filters.gugun).map((r) => r.gugun)
  const left = useColumn(filters)
  const right = useColumn(other ? { ...filters, gugun: other } : null)

  const service = left.prices?.groups?.find((g) => typeof g.median === "number")
  const medianOf = (c: Column) => c.prices?.groups?.find((g) => g.service_id === service?.service_id)?.median
  const cell = (value: number | null | undefined, unit: "shops" | "people" | "won") =>
    value == null ? "—" : t(`unit.${unit}`, { value: fmt.full(Math.round(value)) })

  const rows = [
    { key: "shops", l: cell(left.market?.shops, "shops"), r: cell(right.market?.shops, "shops") },
    { key: "residents", l: cell(left.market?.residents_per_shop, "people"), r: cell(right.market?.residents_per_shop, "people") },
    // Same response as the shop count (permits do not separate every category).
    { key: "opened", l: cell(left.market?.opened_last_year, "shops"), r: cell(right.market?.opened_last_year, "shops") },
    ...(service ? [{ key: "price", l: cell(medianOf(left), "won"), r: cell(medianOf(right), "won") }] : []),
  ]

  return (
    <section aria-labelledby="compare-title" className="flex flex-col gap-4">
      <h2 id="compare-title" className="text-lg font-bold break-keep">{t("title")}</h2>
      <table className="border-border w-full table-fixed overflow-hidden rounded-xl border text-sm">
        <thead className="bg-muted">
          <tr>
            <th scope="col" className="w-24 p-3"><span className="sr-only">{t("metric")}</span></th>
            <th scope="col" className="p-3 text-left font-bold">{filters.gugun}</th>
            <th scope="col" className="p-2 text-left">
              <Select value={other ?? undefined} onValueChange={setOther}>
                <SelectTrigger aria-label={t("pick")} className="h-9 border-0 bg-transparent px-1 font-bold shadow-none">
                  <SelectValue placeholder={t("pick")} />
                </SelectTrigger>
                <SelectContent>
                  {guguns.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-border border-t">
              <th scope="row" className="text-muted-foreground p-3 text-left font-normal">
                {row.key === "price" ? t("row.price", { name: service?.name ?? "" }) : t(`row.${row.key}`)}
              </th>
              <td className="p-3 tabular-nums">{row.l}</td>
              <td className="p-3 tabular-nums">{other ? row.r : <span className="text-muted-foreground">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground text-xs">{t("note")}</p>
    </section>
  )
}
