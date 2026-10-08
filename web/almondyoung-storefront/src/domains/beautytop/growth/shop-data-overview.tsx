"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { formatDate, DATE_FORMATS } from "@/lib/utils/format-date"
import type { BeautyTopShop, BeautyTopTarget } from "../types"
import { useBeautyTop } from "../use-beautytop"
import { useNumberFormats } from "../use-number-formats"
import { CardSkeleton, LoadError } from "../components/parts"
import {
  chronologicalPoints,
  observedChange,
  observedNumber,
  observedRate,
} from "./shop-data"

export function MyShopData({ target }: { target: BeautyTopTarget }) {
  const query = useBeautyTop<BeautyTopShop>({
    resource: "shop",
    id: target.id,
    kind: target.kind,
  })
  if (query.isPending) return <CardSkeleton />
  if (query.isError) return <LoadError onRetry={() => query.refetch()} />
  return <ShopDataOverview shop={query.data} isMine />
}

export function ShopDataOverview({
  shop,
  headingId = "bt-data-overview",
  isMine = false,
}: {
  shop: BeautyTopShop
  headingId?: string
  isMine?: boolean
}) {
  const [showHistory, setShowHistory] = useState(false)
  const [showMenus, setShowMenus] = useState(false)
  const [showOperations, setShowOperations] = useState(false)
  const t = useTranslations("beautytop.dataOverview")
  const fmt = useNumberFormats()
  const date = (value: string | null | undefined) =>
    value && Number.isFinite(Date.parse(value))
      ? formatDate(value, DATE_FORMATS.ISO_DATE)
      : t("dateUnknown")
  const number = (value: number | null | undefined) => {
    const observed = observedNumber(value)
    return observed === null ? t("unknown") : fmt.full(observed)
  }
  const keys = ["visitor_reviews", "blog_reviews", "followers", "posts"]
  const metrics = keys.map((key) => ({
    key,
    metric: shop.growth.metrics.find((item) => item.key === key),
  }))
  metrics.push(
    ...shop.growth.metrics
      .filter((metric) => !keys.includes(metric.key))
      .map((metric) => ({ key: metric.key, metric }))
  )
  const selected = shop.workforce?.selected
  const benchmark = shop.menu_benchmark
  const histories = shop.growth.history?.series ?? []
  return (
    <section
      aria-labelledby={headingId}
      className="border-border bg-background flex flex-col gap-4 rounded-xl border p-4"
    >
      <div>
        <h2 id={headingId} className="text-xl font-bold">
          {t(isMine ? "title" : "publicTitle")}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">{t("subtitle")}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {metrics.map(({ key, metric }) => {
          const delta = metric ? observedChange(metric) : null
          const rate = metric ? observedRate(metric) : null
          return (
            <div key={key} className="bg-muted min-w-0 rounded-lg p-3">
              <dt className="text-muted-foreground text-sm">
                {keys.includes(key)
                  ? t(`metrics.${key}`)
                  : metric?.label || t("otherMetric")}
              </dt>
              <dd className="mt-2 text-lg font-bold break-words tabular-nums">
                {key === "followers" && observedNumber(metric?.current) !== null
                  ? t("approximate", { value: number(metric?.current) })
                  : key === "posts" &&
                      shop.growth.activity?.is_lower_bound &&
                      observedNumber(metric?.current) !== null
                    ? t("atLeast", { value: number(metric?.current) })
                    : number(metric?.current)}
              </dd>
              <dd className="text-muted-foreground mt-2 text-xs">
                {date(metric?.current_at)}
              </dd>
              {observedNumber(metric?.current) !== null && (
                <dd className="text-muted-foreground mt-1 text-xs">
                  {delta !== null
                    ? t("change", {
                        value: `${delta > 0 ? "+" : ""}${fmt.full(delta)}`,
                      })
                    : t(metric?.status === "STALE" ? "stale" : "baseline")}
                </dd>
              )}
              {rate !== null && (
                <dd className="text-muted-foreground mt-1 text-xs tabular-nums">
                  {t("rate", {
                    value: `${rate > 0 ? "+" : ""}${fmt.full(rate)}`,
                  })}
                </dd>
              )}
            </div>
          )
        })}
        {[
          {
            key: "instagram",
            value: shop.metrics?.instagram_score,
            at: shop.metrics?.source_dates?.instagram,
          },
          {
            key: "area",
            value: shop.metrics?.area_m2,
            at: shop.metrics?.source_dates?.public_updated,
          },
        ].map((metric) => (
          <div key={metric.key} className="bg-muted min-w-0 rounded-lg p-3">
            <dt className="text-muted-foreground text-sm">
              {t(`metrics.${metric.key}`)}
            </dt>
            <dd className="mt-2 text-lg font-bold break-words tabular-nums">
              {number(metric.value)}
            </dd>
            <dd className="text-muted-foreground mt-2 text-xs">
              {date(metric.at)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-xs leading-5">
        {t("metricNote")}
      </p>
      <details
        onToggle={(event) => setShowHistory(event.currentTarget.open)}
        className="border-border border-t pt-4"
      >
        <summary className="min-h-12 cursor-pointer text-base font-medium">
          {t("history")}
        </summary>
        {showHistory && (
          <>
            <p className="text-muted-foreground mb-3 text-xs leading-5">
              {t("historyNote")}
            </p>
            {histories.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noHistory")}</p>
            ) : (
              histories.map((series) => {
                const points = chronologicalPoints(series.points)
                return (
                  <details
                    key={series.key}
                    className="border-border border-t py-3"
                  >
                    <summary className="min-h-11 cursor-pointer text-sm font-medium">
                      {series.label} {series.unit && `(${series.unit})`}
                    </summary>
                    {series.stale && (
                      <p className="text-muted-foreground text-xs">
                        {t("stale")}
                      </p>
                    )}
                    {points.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {t("noHistory")}
                      </p>
                    ) : (
                      <table className="mt-2 w-full text-sm tabular-nums">
                        <caption className="sr-only">{series.label}</caption>
                        <thead>
                          <tr>
                            <th className="py-2 text-left font-medium">
                              {t("date")}
                            </th>
                            <th className="py-2 text-right font-medium">
                              {t("value")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {points.map((point, index) => (
                            <tr
                              key={`${point.at}:${index}`}
                              className="border-border border-t"
                            >
                              <td className="py-3">{date(point.at)}</td>
                              <td className="py-3 text-right">
                                {point.approximate
                                  ? t("approximate", {
                                      value: number(point.value),
                                    })
                                  : number(point.value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </details>
                )
              })
            )}
          </>
        )}
      </details>
      <details
        onToggle={(event) => setShowMenus(event.currentTarget.open)}
        className="border-border border-t pt-4"
      >
        <summary className="min-h-12 cursor-pointer text-base font-medium">
          {t("menus")}
        </summary>
        {showMenus && (
          <>
            <p className="text-muted-foreground text-xs leading-5">
              {t("menuNote")}
            </p>
            {benchmark && (
              <dl className="bg-muted my-3 grid grid-cols-3 gap-2 rounded-lg p-3 text-sm">
                {[
                  { key: "min", value: benchmark.min },
                  { key: "median", value: benchmark.median },
                  { key: "max", value: benchmark.max },
                ].map((item) => (
                  <div key={item.key}>
                    <dt className="text-muted-foreground text-xs">
                      {t(item.key)}
                    </dt>
                    <dd className="mt-2 break-words tabular-nums">
                      {number(item.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {shop.price_history.stale && (
              <p className="text-muted-foreground mt-3 text-xs">{t("stale")}</p>
            )}
            {shop.price_history.series.length === 0 ? (
              <p className="text-muted-foreground mt-3 text-sm">
                {t("noMenus")}
              </p>
            ) : (
              shop.price_history.series.map((menu, index) => (
                <details
                  key={`${menu.name}:${index}`}
                  className="border-border mt-3 border-t pt-3"
                >
                  <summary className="min-h-11 cursor-pointer text-sm font-medium break-words">
                    {menu.name}
                  </summary>
                  <ol className="space-y-3 text-sm tabular-nums">
                    {menu.points.map((point, pointIndex) => (
                      <li
                        key={`${point.at}:${pointIndex}`}
                        className="bg-muted flex flex-wrap items-baseline justify-between gap-2 rounded-lg p-3"
                      >
                        <span className="text-muted-foreground">
                          {date(point.at)}
                        </span>
                        <span>
                          {number(point.value)}
                          {observedNumber(point.high) !== null
                            ? `–${number(point.high)}`
                            : ""}{" "}
                          {t("won")}
                        </span>
                        {(!["FIXED", "LISTED"].includes(
                          point.kind?.toUpperCase() ?? ""
                        ) ||
                          point.basis_changed) && (
                          <span className="text-muted-foreground basis-full text-xs">
                            {t("priceBasis")}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              ))
            )}
          </>
        )}
      </details>
      <details
        onToggle={(event) => setShowOperations(event.currentTarget.open)}
        className="border-border border-t pt-4"
      >
        <summary className="min-h-12 cursor-pointer text-base font-medium">
          {t("operations")}
        </summary>
        {showOperations && (
          <>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-muted-foreground">
                  {selected?.label || t("headcount")}
                </dt>
                <dd className="mt-1 font-medium">
                  {shop.workforce?.review_pending
                    ? t("reviewPending")
                    : number(selected?.count)}
                </dd>
                <dd className="text-muted-foreground mt-1 text-xs">
                  {selected?.period || date(selected?.source_date)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("cadence")}</dt>
                <dd className="mt-1 font-medium">
                  {shop.posting?.rank_eligible &&
                  observedNumber(shop.posting.median_gap_days) !== null
                    ? t("days", { value: number(shop.posting.median_gap_days) })
                    : t("cadencePending")}
                </dd>
                <dd className="text-muted-foreground mt-1 text-xs">
                  {date(shop.posting?.observed_at)}
                </dd>
              </div>
              {["7", "30"].map((window) => {
                const period = shop.posting?.windows?.[window]
                return (
                  period && (
                    <div key={window}>
                      <dt className="text-muted-foreground">
                        {t("window", { days: window })}
                      </dt>
                      <dd className="mt-1 font-medium">
                        {period.is_lower_bound
                          ? t("atLeast", { value: number(period.observed) })
                          : number(period.observed)}
                      </dd>
                    </div>
                  )
                )
              })}
            </dl>
            <p className="text-muted-foreground mt-4 text-xs leading-5">
              {t(selected?.is_actual_total ? "operationNote" : "headcountNote")}
            </p>
          </>
        )}
      </details>
    </section>
  )
}
