"use client"

import { Slider } from "@/components/ui/slider"
import { useTranslations } from "next-intl"
import { useScopeLabel } from "../use-scope"
import { useState } from "react"
import type { Filters } from "../components/neighborhood-tab"
import { Chip } from "../components/parts"
import type { BeautyTopPrice, BeautyTopPriceGroup } from "../types"
import { useArea } from "../use-area"
import { useNumberFormats } from "../use-number-formats"
import { priceVerdict } from "./price-verdict"

const STEP = 500

function Ruler({
  group,
  region,
}: {
  group: BeautyTopPriceGroup & { median: number }
  region: string
}) {
  const t = useTranslations("beautytop.ruler")
  const fmt = useNumberFormats()
  const lo = Math.max(0, Math.floor((group.min * 0.8) / STEP) * STEP)
  const hi = Math.ceil((group.max * 1.2) / STEP) * STEP
  const [value, setValue] = useState(Math.round(group.median / STEP) * STEP)
  const [touched, setTouched] = useState(false)
  const at = (v: number) => `${((v - lo) / Math.max(1, hi - lo)) * 100}%`
  const verdict = priceVerdict(value, group)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[40px] leading-[48px] font-bold tabular-nums">
        {t("won", { value: fmt.full(value) })}
      </p>
      <Slider
        min={lo}
        max={hi}
        step={STEP}
        value={[value]}
        onValueChange={([next]) => {
          setValue(next)
          setTouched(true)
        }}
        aria-label={t("sliderLabel", { name: group.name })}
        className="h-11"
      />
      <div className="text-muted-foreground relative h-8 text-xs">
        {(
          [
            ["min", group.min],
            ["median", group.median],
            ["max", group.max],
          ] as const
        ).map(([key, v]) => (
          <span
            key={key}
            className={
              key === "median"
                ? "text-foreground absolute flex -translate-x-1/2 flex-col items-center font-medium"
                : "absolute flex -translate-x-1/2 flex-col items-center"
            }
            style={{ left: at(v) }}
          >
            <span
              className={
                key === "median"
                  ? "bg-foreground h-3 w-0.5"
                  : "h-2 w-px bg-[#8e8e93]"
              }
            />
            {/* The median is what the verdict is measured against, so it is never rounded. */}
            {t(`tick.${key}`, {
              value: key === "median" ? fmt.full(v) : fmt.compact(v),
            })}
          </span>
        ))}
      </div>
      <p className="text-base leading-[22px] break-keep" aria-live="polite">
        {touched
          ? t(`verdict.${verdict.kind}`, {
              diff: fmt.full(verdict.diff),
              region,
            })
          : t("prompt")}
      </p>
      <p className="text-muted-foreground text-xs">
        {t("basis", { brands: group.brands, menus: group.menus, region })}
      </p>
    </div>
  )
}

export function PriceRuler({ filters }: { filters: Filters }) {
  const region = useScopeLabel(filters)
  const t = useTranslations("beautytop.ruler")
  const prices = useArea<BeautyTopPrice>("prices", filters)
  const groups = (prices.data?.groups ?? []).filter(
    (g): g is BeautyTopPriceGroup & { median: number } =>
      typeof g.median === "number" && g.max >= g.min
  )
  const [picked, setPicked] = useState<string | null>(null)
  const group = groups.find((g) => g.service_id === picked) ?? groups[0]

  if (prices.isPending || prices.isError || !group) return null

  return (
    <section aria-labelledby="ruler-title" className="flex flex-col gap-4">
      <h2 id="ruler-title" className="text-lg font-bold break-keep">
        {t("title", { name: group.name })}
      </h2>
      {groups.length > 1 && (
        <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4">
          {groups.map((g) => (
            <Chip
              key={g.service_id}
              active={g.service_id === group.service_id}
              onClick={() => setPicked(g.service_id)}
            >
              {g.name}
            </Chip>
          ))}
        </div>
      )}
      <Ruler key={group.service_id} group={group} region={region} />
      <p className="text-muted-foreground text-xs">{t("private")}</p>
    </section>
  )
}
