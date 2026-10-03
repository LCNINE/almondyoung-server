"use client"

import { queryBeautyTop } from "@/lib/beautytop/client"
import { cn } from "@/lib/utils"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { useState } from "react"
import {
  type BeautyTopMetricRanking,
  type BeautyTopMetricRow,
  type BeautyTopOptions,
  type BeautyTopTarget,
  targetKey,
} from "../types"
import { useNumberFormats } from "../use-number-formats"
import { type Filters, ScopeFilters, useScopeFilters } from "./neighborhood-tab"
import { Card, Chip, Headline, LoadError } from "./parts"

const PAGE_SIZE = 20

const METRICS = {
  reviews: { resource: "ranking", sort: "reviews" },
  followers: { resource: "ranking", sort: "followers" },
  instagram: { resource: "ranking", sort: "instagram" },
  area: { resource: "ranking", sort: "area" },
  staff: { resource: "operating", sort: "staff" },
  reviewStaff: { resource: "operating", sort: "review_staff" },
  activity: { resource: "activity", sort: undefined },
} as const

type Metric = keyof typeof METRICS

const METRIC_KEYS = Object.keys(METRICS) as Metric[]

function metricValue(row: BeautyTopMetricRow, metric: Metric) {
  switch (metric) {
    case "reviews":
      return row.visitor_reviews
    case "followers":
      return row.followers
    case "instagram":
      return row.instagram_score
    case "area":
      return row.area_m2
    case "activity":
      return row.median_gap_days
    default:
      return row.value
  }
}

export function ShopsTab({
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
      <div className="mt-6">
        <Ranking filters={filters} onSelectShop={onSelectShop} />
      </div>
    </>
  )
}

function Ranking({
  filters,
  onSelectShop,
}: {
  filters: Filters
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const t = useTranslations("beautytop")
  const fmt = useNumberFormats()
  const [metric, setMetric] = useState<Metric>("reviews")
  const { resource, sort } = METRICS[metric]

  const ranking = useInfiniteQuery({
    queryKey: ["beautytop", "shops", metric, filters],
    queryFn: ({ pageParam, signal }) =>
      queryBeautyTop<BeautyTopMetricRanking>(
        { resource, sort, ...filters, page: pageParam, page_size: PAGE_SIZE },
        signal
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination?.has_next
        ? (last.pagination.next_page ?? undefined)
        : undefined,
    retry: false,
  })

  const pages = ranking.data?.pages ?? []
  const total = pages[0]?.pagination?.total ?? 0
  const rows = pages.flatMap((page) => page.data.items)
  const top = rows[0]
  const format = (row: BeautyTopMetricRow) => {
    const value = metricValue(row, metric)
    if (value == null) return "–"
    const text =
      metric === "followers"
        ? fmt.compact(value)
        : metric === "instagram"
          ? value.toFixed(1)
          : fmt.full(Math.round(value))
    return t(`shops.value.${metric}`, { value: text })
  }

  return (
    <Card note={t("shops.note")}>
      <div className="scrollbar-hide -mx-6 flex gap-2 overflow-x-auto px-6">
        {METRIC_KEYS.map((key) => (
          <Chip
            key={key}
            active={metric === key}
            onClick={() => setMetric(key)}
          >
            {t(`shops.metric.${key}`)}
          </Chip>
        ))}
      </div>

      <div className="mt-6">
        <Headline
          eyebrow={t("shops.eyebrow", {
            region: filters.gugun,
            category: filters.category,
          })}
        >
          {top
            ? t.rich("shops.headline", {
                metric: t(`shops.metric.${metric}`),
                name: top.name,
                b: (chunks) => <strong>{chunks}</strong>,
              })
            : " "}
        </Headline>
        {total > 0 && (
          <p className="text-muted-foreground mt-2 text-[15px] tabular-nums">
            {t("shops.basis", { total: fmt.full(total) })}
          </p>
        )}
      </div>

      {ranking.isPending ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-14 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : ranking.isError && rows.length === 0 ? (
        <LoadError onRetry={() => ranking.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-[15px] break-keep">
          {t("empty")}
        </p>
      ) : (
        <>
          <ol className="mt-2">
            {rows.map((row) => (
              <li key={targetKey(row.entity_type, row.id)}>
                <button
                  type="button"
                  onClick={() =>
                    onSelectShop({ id: row.id, kind: row.entity_type })
                  }
                  className="hover:bg-muted -mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors duration-150"
                >
                  <span
                    className={cn(
                      "w-8 shrink-0 text-center text-[15px] font-bold tabular-nums",
                      row.rank <= 3
                        ? "text-foreground"
                        : "text-muted-foreground/60"
                    )}
                  >
                    {row.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-[17px] leading-[25.5px] font-medium">
                      {row.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-[13px]">
                      {[row.sido, row.gugun, row.category]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="text-foreground shrink-0 text-[15px] font-bold tabular-nums">
                    {format(row)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {ranking.hasNextPage && (
            <button
              type="button"
              disabled={ranking.isFetchingNextPage}
              onClick={() => ranking.fetchNextPage()}
              className="bg-secondary text-foreground mt-2 h-12 w-full rounded-xl text-[15px] font-medium disabled:opacity-60"
            >
              {t("shops.more", {
                shown: fmt.full(rows.length),
                total: fmt.full(total),
              })}
            </button>
          )}
        </>
      )}
    </Card>
  )
}
