"use client"

import { useTranslations } from "next-intl"
import { useScopeLabel } from "../use-scope"
import type { BeautyTopOptions, BeautyTopTrends } from "../types"
import { useArea } from "../use-area"
import { type Filters, ScopeFilters, useScopeFilters } from "./neighborhood-tab"
import { Big, Card, CardSkeleton, Headline, LoadError, StatTile } from "./parts"

import {
  menuPercent,
  observedMenus,
  observedPercent,
  observedCount,
} from "./trends-observations"
import { useNumberFormats } from "../use-number-formats"
import { formatDate, DATE_FORMATS } from "@/lib/utils/format-date"

export function TrendsTab({ options }: { options: BeautyTopOptions }) {
  const [filters, update] = useScopeFilters()

  return (
    <>
      <ScopeFilters options={options} filters={filters} onChange={update} />
      <div className="mt-6 space-y-4">
        <Trends key={JSON.stringify(filters)} filters={filters} />
      </div>
    </>
  )
}

export function Trends({
  filters,
  onWiden,
}: {
  filters: Filters
  onWiden?: () => void
}) {
  const t = useTranslations("beautytop")
  const region = useScopeLabel(filters)
  const fmt = useNumberFormats()
  // Public aggregate: read through the shared cache, not the member token.
  const trends = useArea<BeautyTopTrends>("trends", filters)

  if (trends.isPending) return <CardSkeleton />
  if (trends.isError)
    return (
      <Card>
        <LoadError onRetry={() => trends.refetch()} />
      </Card>
    )

  const rows = (
    trends.data.procedures?.available ? trends.data.procedures.rows : []
  ).filter((row) => row.category === filters.category)
  const menus = observedMenus(trends.data, filters.category)
  const mentions = rows
    .filter(
      (row) => row.mentions.ready && observedPercent(row.mentions.share_percent)
    )
    .sort(
      (a, b) =>
        (b.mentions.share_percent ?? 0) - (a.mentions.share_percent ?? 0)
    )
  const place = { region, category: filters.category }
  const leadingPercent = menus[0] ? menuPercent(menus[0]) : null
  const sample = trends.data
  const tags = (sample.tags ?? []).filter((tag) => observedCount(tag.accounts))
  const formats = Object.entries(sample.formats ?? {}).filter(([, count]) =>
    observedCount(count)
  )
  const sampleCard = sample.available &&
    observedCount(sample.accounts) &&
    observedCount(sample.posts) && (
      <Card note={sample.note ?? t("trends.sampleNote")}>
        <Headline eyebrow={t("trends.sampleEyebrow", place)}>
          {t("trends.sampleTitle")}
        </Headline>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <StatTile
            label={t("trends.accounts")}
            value={fmt.full(sample.accounts)}
          />
          <StatTile label={t("trends.posts")} value={fmt.full(sample.posts)} />
        </div>
        {sample.start_exclusive && sample.end && (
          <p className="text-muted-foreground mt-3 text-xs">
            {t("trends.window", {
              start: formatDate(sample.start_exclusive, DATE_FORMATS.ISO_DATE),
              end: formatDate(sample.end, DATE_FORMATS.ISO_DATE),
            })}
          </p>
        )}
        {sample.truncated && (
          <p className="text-muted-foreground mt-3 text-xs">
            {t("trends.truncated")}
          </p>
        )}
        <details className="mt-4">
          <summary className="text-foreground cursor-pointer text-sm font-medium">
            {t("trends.sampleDetails")}
          </summary>
          <dl className="mt-3 space-y-2 text-sm">
            {observedCount(sample.fresh_accounts_checked) && (
              <div className="flex justify-between gap-4">
                <dt>{t("trends.freshAccounts")}</dt>
                <dd>{fmt.full(sample.fresh_accounts_checked)}</dd>
              </div>
            )}
            {formats.map(([kind, count]) => (
              <div key={kind} className="flex justify-between gap-4">
                <dt>
                  {["PHOTO", "REEL", "CAROUSEL"].includes(kind)
                    ? t(`trends.format.${kind}`)
                    : kind}
                </dt>
                <dd>{fmt.full(count)}</dd>
              </div>
            ))}
          </dl>
          {tags.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-medium">{t("trends.tags")}</h3>
              <ul className="divide-border mt-2 divide-y">
                {tags.map((tag) => (
                  <li
                    key={tag.tag}
                    className="flex justify-between gap-4 py-2 text-sm"
                  >
                    <span className="min-w-0 break-all">
                      #{tag.tag.replace(/^#/, "")}
                    </span>
                    <span className="shrink-0">
                      {t("trends.tagAccounts", { count: tag.accounts })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      </Card>
    )
  if (!sample.available && menus.length === 0 && mentions.length === 0) {
    return (
      <Card note={sample.note}>
        <p className="text-muted-foreground py-6 text-center text-sm">
          {t("trends.recentCollecting")}
        </p>
        {onWiden && filters.gugun && (
          <button
            type="button"
            onClick={onWiden}
            className="bg-secondary mx-auto block h-10 rounded-full px-4 text-sm"
          >
            {t("trends.widen", { sido: filters.sido })}
          </button>
        )}
      </Card>
    )
  }

  return (
    <>
      {menus.length === 0 && sampleCard}
      {menus.length === 0 ? (
        <div>
          <p className="text-muted-foreground py-6 text-center text-[15px] break-keep">
            {t("trends.menuCollecting")}
          </p>
          {onWiden && filters.gugun && (
            <button
              type="button"
              onClick={onWiden}
              className="bg-secondary mx-auto mb-4 block h-10 rounded-full px-4 text-[13px] font-medium"
            >
              {t("trends.widen", { sido: filters.sido })}
            </button>
          )}
        </div>
      ) : (
        <Card note={sample.procedures?.note ?? t("trends.menuNote")}>
          <Headline eyebrow={t("trends.menuEyebrow", place)}>
            {leadingPercent !== null
              ? t.rich("trends.menuHeadline", {
                  name: menus[0].name,
                  pct: Math.round(leadingPercent),
                  b: (chunks) => <Big>{chunks}</Big>,
                })
              : t.rich("trends.observedHeadline", {
                  name: menus[0].name,
                  current: menus[0].adoption.current_shops,
                  b: (chunks) => <Big>{chunks}</Big>,
                })}
          </Headline>
          <ul className="mt-6 space-y-5">
            {menus.map((row) => {
              const pct = menuPercent(row)
              return (
                <li key={row.id}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-foreground text-[17px] leading-[25.5px] font-medium">
                      {row.name}
                    </span>
                    <span className="text-foreground text-[17px] font-bold tabular-nums">
                      {pct !== null
                        ? `${Math.round(pct)}%`
                        : t("trends.observedShops", {
                            count: row.adoption.current_shops,
                          })}
                    </span>
                  </div>
                  {pct !== null && (
                    <div className="bg-secondary mt-3 h-2 rounded-full">
                      <div
                        className="bg-foreground h-full rounded-full"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  )}
                  <div className="text-muted-foreground mt-2 flex justify-between text-[13px] tabular-nums">
                    <span>
                      {t("trends.menuBasis", {
                        current: row.adoption.current_shops,
                        checked: row.adoption.checked_shops,
                      })}
                    </span>
                    {row.regional.ready &&
                      observedPercent(row.regional.national_percent) && (
                        <span>
                          {t("trends.national", {
                            pct: Math.round(row.regional.national_percent),
                          })}
                        </span>
                      )}
                  </div>
                </li>
              )
            })}
          </ul>
          {menus.some((row) => menuPercent(row) === null) && (
            <p className="text-muted-foreground mt-4 text-sm">
              {t("trends.comparisonPending")}
            </p>
          )}
          {Object.values(sample.procedures?.truncated ?? {}).some(Boolean) && (
            <p className="text-muted-foreground mt-3 text-xs">
              {t("trends.menuTruncated")}
            </p>
          )}
        </Card>
      )}

      {(mentions.length > 0 || menus.length > 0) && (
        <Card note={t("trends.mentionNote")}>
          <Headline eyebrow={t("trends.mentionEyebrow")}>
            {mentions.length > 0
              ? t("trends.mentionHeadline", { name: mentions[0].name })
              : t("trends.collecting")}
          </Headline>
          {mentions.length > 0 && (
            <ul className="divide-border mt-4 divide-y">
              {mentions.map((row) => (
                <li
                  key={row.id}
                  className="flex items-baseline justify-between gap-4 py-3 text-[15px]"
                >
                  <span className="text-foreground min-w-0 truncate font-medium">
                    {row.name}
                  </span>
                  <span className="text-foreground shrink-0 font-bold tabular-nums">
                    {Math.round(row.mentions.share_percent ?? 0)}%
                    {row.growth.ready &&
                      row.growth.change_pp != null &&
                      Number.isFinite(row.growth.change_pp) &&
                      Math.abs(row.growth.change_pp) <= 100 && (
                        <span className="text-muted-foreground ml-2 text-[13px] font-medium">
                          {row.growth.change_pp >= 0 ? "▲" : "▼"}{" "}
                          {Math.abs(row.growth.change_pp).toFixed(1)}%p
                        </span>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {menus.length > 0 && sampleCard}
    </>
  )
}
