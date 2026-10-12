"use client"

import type { GrowthAction } from "@/lib/types/ui/beautytop-growth"
import { observedNumber } from "./shop-data"
import { Button } from "@/components/ui/button"
import { formatDate, DATE_FORMATS } from "@/lib/utils/format-date"
import { useTranslations } from "next-intl"
import type { BeautyTopShop, BeautyTopTarget } from "../types"
import { useBeautyTop } from "../use-beautytop"
import { useMyShop } from "../use-watchlist"
import { useNumberFormats } from "../use-number-formats"
import { CardSkeleton, LoadError } from "../components/parts"

function observedMetric(shop: BeautyTopShop | undefined, key: string) {
  return shop?.growth.metrics.find((m) => m.key === key)
}

export function ShopComparison({
  target,
  onFindMine,
  onClose,
  onPlanAction,
}: {
  target: BeautyTopTarget
  onFindMine: () => void
  onClose: () => void
  onPlanAction: (action: GrowthAction) => void
}) {
  const t = useTranslations("beautytop.discovery")
  const fmt = useNumberFormats()
  const [mine] = useMyShop()
  const own = useBeautyTop<BeautyTopShop>(
    { resource: "shop", id: mine?.id, kind: mine?.kind },
    !!mine
  )
  const other = useBeautyTop<BeautyTopShop>(
    { resource: "shop", id: target.id, kind: target.kind },
    !!mine
  )

  if (mine === undefined) return <CardSkeleton />
  if (mine === null)
    return (
      <section className="border-border flex flex-col gap-4 rounded-xl border p-4">
        <h3 className="text-lg font-bold">{t("chooseMine")}</h3>
        <p className="text-muted-foreground text-sm">{t("chooseMineHint")}</p>
        <Button onClick={onFindMine} className="h-[52px] rounded-xl">
          {t("findMine")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
      </section>
    )
  if (own.isPending || other.isPending) return <CardSkeleton />
  if (own.isError || other.isError)
    return (
      <LoadError
        onRetry={() => {
          void own.refetch()
          void other.refetch()
        }}
      />
    )

  const rows = ["visitor_reviews", "followers", "cadence"]
  const value = (shop: BeautyTopShop, key: string) => {
    if (key === "cadence")
      return (
        <>
          <span className="block font-bold tabular-nums">
            {shop.posting?.rank_eligible &&
            observedNumber(shop.posting.median_gap_days) !== null
              ? t("cadence", {
                  days: fmt.full(shop.posting.median_gap_days ?? 0),
                })
              : t("unknown")}
          </span>
          {shop.posting?.observed_at && (
            <span className="text-muted-foreground block text-xs">
              {formatDate(shop.posting.observed_at, DATE_FORMATS.ISO_DATE)}
            </span>
          )}
        </>
      )
    const metric = observedMetric(shop, key)
    return (
      <>
        <span className="block font-bold tabular-nums">
          {observedNumber(metric?.current) === null
            ? t("unknown")
            : key === "followers"
              ? t("approximate", { value: fmt.full(metric?.current ?? 0) })
              : fmt.full(metric?.current ?? 0)}
        </span>
        {metric?.current_at && (
          <span className="text-muted-foreground block text-xs">
            {formatDate(metric.current_at, DATE_FORMATS.ISO_DATE)}
          </span>
        )}
        {metric?.status === "STALE" && (
          <span className="text-muted-foreground block text-xs">
            {t("oldObservation")}
          </span>
        )}
      </>
    )
  }
  return (
    <section
      className="border-border flex flex-col gap-4 rounded-xl border p-4"
      aria-labelledby="bt-comparison-title"
    >
      <div className="flex items-center justify-between gap-4">
        <h3 id="bt-comparison-title" className="text-lg font-bold">
          {t("comparisonTitle")}
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
      <div className="border-border grid grid-cols-2 gap-3 border-b pb-4 text-sm">
        <div className="min-w-0">
          <span className="text-muted-foreground text-xs">{t("mine")}</span>
          <p className="mt-1 font-bold break-words">{own.data.name}</p>
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground text-xs">
            {t("selectedShop")}
          </span>
          <p className="mt-1 font-bold break-words">{other.data.name}</p>
        </div>
      </div>
      <dl className="space-y-4">
        {rows.map((key) => {
          const ownValue = observedNumber(
            observedMetric(own.data, key)?.current
          )
          const otherValue = observedNumber(
            observedMetric(other.data, key)?.current
          )
          const max = Math.max(ownValue ?? 0, otherValue ?? 0)
          return (
            <div key={key}>
              <dt className="mb-2 text-sm font-medium">
                {t(`metricLabel.${key}`)}
              </dt>
              <dd className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { shop: own.data, number: ownValue },
                  { shop: other.data, number: otherValue },
                ].map((entry, index) => (
                  <div
                    key={index}
                    className="bg-background min-w-0 rounded-lg p-3"
                  >
                    {value(entry.shop, key)}
                    {key !== "cadence" &&
                      ownValue !== null &&
                      otherValue !== null &&
                      max > 0 && (
                        <div
                          aria-hidden
                          className="bg-secondary mt-3 h-1 overflow-hidden rounded-full"
                        >
                          <div
                            className={
                              index === 0
                                ? "bg-foreground h-full"
                                : "bg-muted-foreground h-full"
                            }
                            style={{
                              width: `${((entry.number ?? 0) / max) * 100}%`,
                            }}
                          />
                        </div>
                      )}
                  </div>
                ))}
              </dd>
            </div>
          )
        })}
      </dl>
      <details className="text-muted-foreground text-xs leading-5">
        <summary className="cursor-pointer py-2">
          {t("comparisonSummary")}
        </summary>
        <p className="mt-2">{t("comparisonNote")}</p>
      </details>
      <details className="border-border border-t pt-4">
        <summary className="min-h-11 text-sm font-medium">
          {t("learnTitle")}
        </summary>
        <ul className="text-muted-foreground mt-3 list-disc space-y-2 pl-4 text-sm">
          <li>{t("learnMenu")}</li>
          <li>{t("learnPosts")}</li>
          <li>{t("learnObserve")}</li>
        </ul>
        <p className="text-muted-foreground mt-4 text-xs">{t("learnNote")}</p>
      </details>
      <div className="grid gap-2">
        {(["MENU_CLARITY", "SHOWCASE", "PRICE_CHANGE"] as const).map(
          (action) => (
            <Button
              key={action}
              variant="secondary"
              onClick={() => onPlanAction(action)}
              className="h-auto min-h-12 whitespace-normal"
            >
              {t(`nextActions.${action}`)}
            </Button>
          )
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t("nextActionNote")}</p>
    </section>
  )
}
