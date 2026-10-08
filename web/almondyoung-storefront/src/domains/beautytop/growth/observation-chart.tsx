"use client"

import { useId, useState } from "react"
import { useTranslations } from "next-intl"
import { formatDate, DATE_FORMATS } from "@/lib/utils/format-date"
import { chronologicalPoints } from "./shop-data"
import { useNumberFormats } from "../use-number-formats"

import { observationPlot } from "./observation-plot"

export function ObservationChart({
  points,
  label,
  unit,
}: {
  points: { at: string; value: number; approximate?: boolean }[]
  label: string
  unit: string
}) {
  const t = useTranslations("beautytop.dataOverview")
  const fmt = useNumberFormats()
  const id = useId()
  const ordered = chronologicalPoints(points)
  const plot = observationPlot(ordered)
  const [selection, setSelection] = useState<number | null>(null)
  const index = Math.min(selection ?? ordered.length - 1, ordered.length - 1)
  const point = ordered[index]
  if (!point) return null
  const active = plot[index]
  const date = (value: string) => formatDate(value, DATE_FORMATS.ISO_DATE)
  const min = Math.min(...ordered.map((item) => item.value))
  const max = Math.max(...ordered.map((item) => item.value))
  return (
    <div className="bg-muted my-3 rounded-xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-muted-foreground text-xs">{date(point.at)}</p>
        <p className="text-xl font-bold tabular-nums">
          {point.approximate
            ? t("approximate", { value: fmt.full(point.value) })
            : fmt.full(point.value)}
          <span className="ml-1 text-sm font-medium">{unit}</span>
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="text-muted-foreground flex w-12 shrink-0 flex-col justify-between py-3 text-xs tabular-nums">
          <span>{fmt.compact(max)}</span>
          <span>{fmt.compact(min)}</span>
        </div>
        <svg
          aria-hidden="true"
          viewBox="0 0 320 160"
          className="text-foreground h-40 min-w-0 flex-1 overflow-visible"
        >
          {[16, 80, 144].map((y) => (
            <line
              key={y}
              x1="16"
              x2="304"
              y1={y}
              y2={y}
              className="stroke-border"
              strokeWidth="1"
            />
          ))}
          <line
            x1={active.x}
            x2={active.x}
            y1="16"
            y2="144"
            className="stroke-muted-foreground"
            strokeDasharray="3 4"
          />
          {plot.map((item, i) => (
            <circle
              key={`${item.at}:${i}`}
              cx={item.x}
              cy={item.y}
              r={i === index ? 5 : 3}
              className={
                i === index ? "fill-foreground" : "fill-muted-foreground"
              }
            />
          ))}
        </svg>
      </div>
      <div className="text-muted-foreground mb-2 flex justify-between gap-2 text-xs tabular-nums">
        <span>{date(ordered[0].at)}</span>
        <span>{date(ordered[ordered.length - 1].at)}</span>
      </div>
      {ordered.length > 1 && (
        <label htmlFor={id} className="text-muted-foreground block text-xs">
          {t("chartSelect")} · {label}
          <input
            id={id}
            type="range"
            min={0}
            max={ordered.length - 1}
            step={1}
            value={index}
            aria-valuetext={`${date(point.at)}, ${point.approximate ? t("approximate", { value: fmt.full(point.value) }) : fmt.full(point.value)} ${unit}`}
            onChange={(event) => setSelection(Number(event.target.value))}
            className="accent-foreground focus-visible:outline-ring mt-1 block h-12 w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </label>
      )}
      <p className="text-muted-foreground mt-2 text-xs leading-5">
        {t("chartNote")}
      </p>
    </div>
  )
}
