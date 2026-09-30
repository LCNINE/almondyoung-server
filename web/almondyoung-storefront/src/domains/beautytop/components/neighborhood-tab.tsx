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
import {
  type BeautyTopLifecycle,
  BeautyTopMarket,
  BeautyTopOptions,
  BeautyTopPrice,
  BeautyTopPriceGroup,
  BeautyTopPriceList,
  BeautyTopRevenue,
  BeautyTopTarget,
  targetKey,
} from "../types"
import { useBeautyTop } from "../use-beautytop"
import { useNumberFormats } from "../use-number-formats"
import {
  Bars,
  Big,
  Card,
  CardSkeleton,
  Chip,
  Headline,
  LoadError,
  Segmented,
  StatTile,
  stripLeadingSymbols,
} from "./parts"

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

export function NeighborhoodTab({
  options,
  onSelectShop,
}: {
  options: BeautyTopOptions
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const [filters, update] = useScopeFilters()

  return (
    <>
      <ScopeFilters options={options} filters={filters} onChange={update} />
      <Sections
        key={JSON.stringify(filters)}
        filters={filters}
        onSelectShop={onSelectShop}
      />
    </>
  )
}

function Sections({
  filters,
  onSelectShop,
}: {
  filters: Filters
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const t = useTranslations("beautytop")
  const scope = {
    sido: filters.sido,
    gugun: filters.gugun,
    category: filters.category,
  }
  const place = { region: filters.gugun, category: filters.category }
  const price = useBeautyTop<BeautyTopPrice>({
    resource: "price-comparison",
    ...scope,
    page_size: 1,
  })
  const market = useBeautyTop<BeautyTopMarket>({ resource: "market", ...scope })
  const lifecycle = useBeautyTop<BeautyTopLifecycle>({
    resource: "lifecycle",
    ...scope,
  })
  const revenue = useBeautyTop<BeautyTopRevenue>({
    resource: "revenue",
    ...scope,
  })

  const priceGroups = price.data?.available ? price.data.groups : []
  const marketData = market.data?.available ? market.data : null
  const revenueGroup = revenue.data?.available
    ? revenue.data.groups?.[0]
    : undefined

  const nothing =
    price.isSuccess && market.isSuccess && !priceGroups.length && !marketData

  return (
    <div className="mt-6 space-y-4">
      {nothing && (
        <Card>
          <p className="text-muted-foreground py-6 text-center text-[15px] break-keep">
            {t("empty")}
          </p>
        </Card>
      )}
      {price.isPending ? (
        <CardSkeleton />
      ) : price.isError ? (
        <Card>
          <LoadError onRetry={() => price.refetch()} />
        </Card>
      ) : (
        priceGroups.length > 0 && (
          <Card note={t("price.note")}>
            <PriceCard
              groups={priceGroups}
              place={place}
              scope={scope}
              onSelectShop={onSelectShop}
            />
          </Card>
        )
      )}

      {market.isPending ? (
        <CardSkeleton />
      ) : market.isError ? (
        <Card>
          <LoadError onRetry={() => market.refetch()} />
        </Card>
      ) : (
        marketData && (
          <Card note={t("market.note")}>
            <MarketCard
              market={marketData}
              lifecycle={lifecycle.data?.available ? lifecycle.data : null}
              place={place}
            />
          </Card>
        )
      )}

      {revenueGroup && revenueGroup.series.length > 1 && (
        <Card note={t("revenue.note")}>
          <RevenueCard group={revenueGroup} region={filters.gugun} />
        </Card>
      )}
    </div>
  )
}

function PriceCard({
  groups,
  place,
  scope,
  onSelectShop,
}: {
  scope: { sido: string; gugun: string; category: string }
  onSelectShop: (target: BeautyTopTarget) => void
  groups: BeautyTopPrice["groups"]
  place: { region: string; category: string }
}) {
  const t = useTranslations("beautytop")
  const fmt = useNumberFormats()
  const [open, setOpen] = useState<string | null>(null)
  const priced = (g: BeautyTopPriceGroup) => g.median != null && g.median > 0
  const candidates = groups.some(priced) ? groups.filter(priced) : groups
  const lead = candidates.reduce((a, b) => (b.menus > a.menus ? b : a))
  const priceText = (g: BeautyTopPriceGroup) =>
    t("unit.won", {
      value: priced(g)
        ? fmt.full(g.median ?? 0)
        : g.minimum === g.maximum
          ? fmt.full(g.minimum)
          : `${fmt.compact(g.minimum)}~${fmt.compact(g.maximum)}`,
    })
  const scaleMin = Math.min(...groups.map((g) => g.minimum))
  const scaleMax = Math.max(...groups.map((g) => g.maximum))
  const pct = (value: number) =>
    `${Math.min(100, Math.max(0, ((value - scaleMin) / Math.max(1, scaleMax - scaleMin)) * 100))}%`

  return (
    <>
      <Headline eyebrow={t("price.eyebrow", place)}>
        {t.rich(priced(lead) ? "price.headline" : "price.headlineRange", {
          service: lead.name,
          price: priceText(lead),
          b: (chunks) => <Big>{chunks}</Big>,
        })}
      </Headline>

      <ul className="mt-6 space-y-5">
        {groups.map((group) => (
          <li key={group.service_id}>
            <button
              type="button"
              aria-expanded={open === group.service_id}
              onClick={() =>
                setOpen(open === group.service_id ? null : group.service_id)
              }
              className="block w-full text-left"
            >
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-foreground text-[17px] leading-[25.5px] font-medium">
                  {group.name}
                </span>
                <span className="text-foreground text-[17px] font-bold tabular-nums">
                  {priceText(group)}
                </span>
              </div>
              <div className="bg-secondary relative mt-3 h-1.5 rounded-full">
                <div
                  className="bg-border absolute inset-y-0 rounded-full"
                  style={{
                    left: `min(${pct(group.minimum)}, calc(100% - 6px))`,
                    width: `calc(${pct(group.maximum)} - ${pct(group.minimum)})`,
                    minWidth: 6,
                  }}
                />
                {priced(group) && (
                  <div
                    className="bg-primary absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                    style={{ left: pct(group.median ?? 0) }}
                  />
                )}
              </div>
              <div className="text-muted-foreground mt-2 flex justify-between text-[13px] tabular-nums">
                <span>
                  {priced(group) &&
                    `${fmt.compact(group.minimum)} ~ ${fmt.compact(group.maximum)}`}
                </span>
                <span>
                  {t("price.basis", {
                    shops: group.brands,
                    menus: group.menus,
                  })}{" "}
                  {open === group.service_id ? "▴" : "▾"}
                </span>
              </div>
            </button>
            {open === group.service_id && (
              <PriceExtremes
                scope={scope}
                service={group.service_id}
                onSelectShop={onSelectShop}
              />
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

function PriceExtremes({
  scope,
  service,
  onSelectShop,
}: {
  scope: { sido: string; gugun: string; category: string }
  service: string
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const t = useTranslations("beautytop")
  const fmt = useNumberFormats()
  const [order, setOrder] = useState<"low" | "high">("low")
  const list = useBeautyTop<BeautyTopPriceList>({
    resource: "price-comparison",
    ...scope,
    service,
    order,
    page_size: 3,
  })
  const items = list.data?.available ? (list.data.items ?? []) : []

  return (
    <div className="bg-muted mt-3 rounded-xl p-3">
      <Segmented
        value={order}
        onChange={setOrder}
        className="bg-border/60"
        options={[
          { value: "low", label: t("price.cheapest") },
          { value: "high", label: t("price.priciest") },
        ]}
      />
      {list.isPending ? (
        <div className="bg-background mt-3 h-24 animate-pulse rounded-lg" />
      ) : list.isError ? (
        <LoadError onRetry={() => list.refetch()} />
      ) : (
        <ol className="mt-2">
          {items.map((item, index) => (
            <li key={`${targetKey(item.entity_type, item.id)}-${index}`}>
              <button
                type="button"
                onClick={() =>
                  onSelectShop({ id: item.id, kind: item.entity_type })
                }
                className="flex w-full items-center gap-3 rounded-lg px-1 py-3 text-left"
              >
                <span className="text-muted-foreground w-4 shrink-0 text-center text-[15px] font-bold">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-[15px] font-medium">
                    {item.name}
                  </span>
                  <span className="text-muted-foreground block truncate text-[13px]">
                    {stripLeadingSymbols(item.menu_name)}
                  </span>
                </span>
                <span className="text-foreground shrink-0 text-[15px] font-bold tabular-nums">
                  {t("unit.won", { value: fmt.full(item.value) })}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function MarketCard({
  market,
  lifecycle,
  place,
}: {
  market: BeautyTopMarket
  lifecycle: BeautyTopLifecycle | null
  place: { region: string; category: string }
}) {
  const t = useTranslations("beautytop")
  const fmt = useNumberFormats()
  const opened = lifecycle?.opened ?? market.opened_last_year ?? 0
  const monthly = lifecycle?.monthly ?? []
  const monthLabel = (month: string) => month.slice(2).replace("-", ".")

  return (
    <>
      <Headline eyebrow={t("market.eyebrow", place)}>
        {t.rich("market.headline", {
          count: fmt.full(market.shops ?? 0),
          b: (chunks) => <Big>{chunks}</Big>,
        })}
      </Headline>
      <p className="text-muted-foreground mt-2 text-[15px]">
        {lifecycle?.closed !== undefined
          ? t("market.openedClosed", {
              opened: fmt.full(opened),
              closed: fmt.full(lifecycle.closed),
            })
          : t("market.opened", { opened: fmt.full(opened) })}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <StatTile
          label={t("market.newLabel")}
          value={t("unit.count", { value: fmt.full(opened) })}
        />
        {lifecycle?.closed !== undefined ? (
          <StatTile
            label={t("market.closedLabel")}
            value={t("unit.count", { value: fmt.full(lifecycle.closed) })}
          />
        ) : (
          market.residents_per_shop != null &&
          market.residents_per_shop > 0 && (
            <StatTile
              label={t("market.densityLabel")}
              value={t("market.perResidents", {
                count: fmt.full(market.residents_per_shop),
              })}
            />
          )
        )}
      </div>

      {monthly.length > 1 && (
        <>
          <p className="text-foreground mt-6 text-[15px] font-medium">
            {t("market.chartTitle")}
          </p>
          <Bars
            values={monthly.map((m) => m.opened)}
            firstLabel={monthLabel(monthly[0].month)}
            lastLabel={monthLabel(monthly[monthly.length - 1].month)}
            lastAnnotation={`+${monthly[monthly.length - 1].opened}`}
          />
        </>
      )}
    </>
  )
}

function RevenueCard({
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
