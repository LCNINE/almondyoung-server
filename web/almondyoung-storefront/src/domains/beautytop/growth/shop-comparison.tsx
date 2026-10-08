"use client"

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
}: {
  target: BeautyTopTarget
  onFindMine: () => void
  onClose: () => void
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
            {shop.posting?.rank_eligible && shop.posting.median_gap_days != null
              ? t("cadence", { days: fmt.full(shop.posting.median_gap_days) })
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
          {metric?.current == null ? t("unknown") : fmt.full(metric.current)}
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
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-border border-b text-left">
            <th scope="col" className="w-20 py-3 pr-2 font-normal">
              {t("metric")}
            </th>
            <th scope="col" className="px-2 py-3 break-words">
              {own.data.name}
              <span className="text-muted-foreground block text-xs font-normal">
                {t("mine")}
              </span>
            </th>
            <th scope="col" className="px-2 py-3 break-words">
              {other.data.name}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((key) => (
            <tr key={key} className="border-border border-b">
              <th
                scope="row"
                className="text-muted-foreground py-4 pr-2 text-left font-normal"
              >
                {t(`metricLabel.${key}`)}
              </th>
              <td className="px-2 py-4 align-top">{value(own.data, key)}</td>
              <td className="px-2 py-4 align-top">{value(other.data, key)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground text-xs leading-5">
        {t("comparisonNote")}
      </p>
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
    </section>
  )
}
