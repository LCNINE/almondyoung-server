"use client"

import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { useScopeLabel } from "../use-scope"
import { useState } from "react"
import { useScopeFilters } from "../components/neighborhood-tab"
import { Chip, LoadError, stripLeadingSymbols } from "../components/parts"
import type {
  BeautyTopPrice,
  BeautyTopPriceList,
  BeautyTopTarget,
} from "../types"
import { useArea } from "../use-area"
import { useBeautyTop } from "../use-beautytop"
import { useNumberFormats } from "../use-number-formats"
import { placeAmong } from "./price-place"

const STEP = 500
const LIST_SIZE = 30

function Simulator({
  service,
  name,
  scope,
  onSelectShop,
}: {
  service: string
  name: string
  scope: { sido: string; gugun: string; category: string }
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const t = useTranslations("beautytop.simulator")
  const fmt = useNumberFormats()
  // Member data: named shops and their menu prices for this service, cheapest first.
  const list = useBeautyTop<BeautyTopPriceList>({
    resource: "price-comparison",
    ...scope,
    service,
    order: "low",
    page_size: LIST_SIZE,
  })
  const items = list.data?.available ? (list.data.items ?? []) : []
  const values = items.map((i) => i.value)
  const lo = values.length
    ? Math.floor((Math.min(...values) * 0.8) / STEP) * STEP
    : 0
  const hi = values.length
    ? Math.ceil((Math.max(...values) * 1.2) / STEP) * STEP
    : 0
  const [mine, setMine] = useState<number | null>(null)
  const value =
    mine ?? (values.length ? values[Math.floor(values.length / 2)] : 0)

  if (list.isPending)
    return <div className="bg-muted h-40 animate-pulse rounded-xl" />
  if (list.isError) return <LoadError onRetry={() => list.refetch()} />
  if (items.length < 3)
    return <p className="text-muted-foreground text-sm">{t("tooFew")}</p>

  const where = placeAmong(values, value)
  const insertAt = where.cheaper + where.same

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[26px] leading-[35px] font-bold tabular-nums">
        {t("won", { value: fmt.full(value) })}
      </p>
      <Slider
        min={lo}
        max={hi}
        step={STEP}
        value={[value]}
        onValueChange={([v]) => setMine(v)}
        aria-label={t("sliderLabel", { name })}
        className="h-11"
      />
      <p className="text-base leading-[22px] break-keep" aria-live="polite">
        {mine === null
          ? t("prompt")
          : t("place", {
              place: where.place,
              total: where.total,
              same: where.same,
            })}
      </p>
      <ol className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={`${item.entity_type}:${item.id}:${index}`}>
            {index === insertAt && mine !== null && (
              <MineRow
                label={t("mine")}
                value={t("won", { value: fmt.full(value) })}
              />
            )}
            <button
              type="button"
              onClick={() =>
                onSelectShop({ id: item.id, kind: item.entity_type })
              }
              className="hover:bg-muted flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-150"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">
                  {item.name}
                </span>
                <span className="text-muted-foreground block truncate text-[13px]">
                  {stripLeadingSymbols(item.menu_name)}
                </span>
              </span>
              <span className="shrink-0 text-[15px] font-bold tabular-nums">
                {t("won", { value: fmt.full(item.value) })}
              </span>
            </button>
          </li>
        ))}
        {insertAt >= items.length && mine !== null && (
          <li>
            <MineRow
              label={t("mine")}
              value={t("won", { value: fmt.full(value) })}
            />
          </li>
        )}
      </ol>
      <p className="text-muted-foreground text-xs">
        {t("note", { count: items.length })}
      </p>
    </div>
  )
}

function MineRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className={cn(
        "border-primary flex items-center justify-between rounded-lg border-2 border-dashed px-2 py-2"
      )}
    >
      <span className="text-[15px] font-bold">{label}</span>
      <span className="text-[15px] font-bold tabular-nums">{value}</span>
    </div>
  )
}

/** Member tool: slide your own price and see it among neighbouring shops' menus, by name. */
export function PriceSimulator({
  onSelectShop,
}: {
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const t = useTranslations("beautytop.simulator")
  const [filters] = useScopeFilters()
  const region = useScopeLabel(filters)
  const groups = useArea<BeautyTopPrice>("prices", filters).data?.groups ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const group = groups.find((g) => g.service_id === picked) ?? groups[0]
  if (!group) return null

  return (
    <section
      aria-labelledby="bt-simulator"
      className="bg-background flex flex-col gap-4 rounded-2xl p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="bt-simulator" className="text-lg font-bold">
          {t("title")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("subtitle", { region, category: filters.category })}
        </p>
      </div>
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
      <Simulator
        key={`${filters.sido}:${filters.gugun}:${filters.category}:${group.service_id}`}
        service={group.service_id}
        name={group.name}
        scope={filters}
        onSelectShop={onSelectShop}
      />
    </section>
  )
}
