"use client"

import { useTranslations } from "next-intl"
import type {
  BeautyTopOptions,
  BeautyTopProcedure,
  BeautyTopTrends,
} from "../types"
import { useBeautyTop } from "../use-beautytop"
import { type Filters, ScopeFilters, useScopeFilters } from "./neighborhood-tab"
import { Big, Card, CardSkeleton, Headline, LoadError } from "./parts"

function menuPercent(row: BeautyTopProcedure) {
  if (row.regional.ready && row.regional.local_percent != null)
    return row.regional.local_percent
  return (row.adoption.current_shops / row.adoption.checked_shops) * 100
}

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

function Trends({ filters }: { filters: Filters }) {
  const t = useTranslations("beautytop")
  const trends = useBeautyTop<BeautyTopTrends>({
    resource: "trends",
    ...filters,
  })

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
  const menus = rows
    .filter((row) => row.adoption.checked_shops > 0)
    .sort((a, b) => menuPercent(b) - menuPercent(a))
  const mentions = rows
    .filter((row) => row.mentions.ready && row.mentions.share_percent != null)
    .sort(
      (a, b) => (b.mentions.share_percent ?? 0) - (a.mentions.share_percent ?? 0)
    )
  const place = { region: filters.gugun, category: filters.category }

  return (
    <>
      {menus.length === 0 ? (
        <Card>
          <p className="text-muted-foreground py-6 text-center text-[15px] break-keep">
            {t("empty")}
          </p>
        </Card>
      ) : (
        <Card note={t("trends.menuNote")}>
          <Headline eyebrow={t("trends.menuEyebrow", place)}>
            {t.rich("trends.menuHeadline", {
              name: menus[0].name,
              pct: Math.round(menuPercent(menus[0])),
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
                      {Math.round(pct)}%
                    </span>
                  </div>
                  <div className="bg-secondary mt-3 h-1.5 rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <div className="text-muted-foreground mt-2 flex justify-between text-[13px] tabular-nums">
                    <span>
                      {t("trends.menuBasis", {
                        current: row.adoption.current_shops,
                        checked: row.adoption.checked_shops,
                      })}
                    </span>
                    {row.regional.ready &&
                      row.regional.national_percent != null && (
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
        </Card>
      )}

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
                  {row.growth.ready && row.growth.change_pp != null && (
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
    </>
  )
}
