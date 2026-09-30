"use client"

import { cn } from "@/lib/utils"
import { Search } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import {
  type BeautyTopBriefing,
  BeautyTopChanges,
  BeautyTopPeerMetric,
  BeautyTopPosition,
  BeautyTopSearch,
  BeautyTopShopSummary,
  BeautyTopTarget,
  BeautyTopWatch,
  targetKey,
} from "../types"
import { useBeautyTop } from "../use-beautytop"
import { useNumberFormats } from "../use-number-formats"
import { type WatchedShop, useWatchlist } from "../use-watchlist"
import { DEFAULT_FILTERS, FILTERS_KEY } from "./neighborhood-tab"
import {
  Big,
  Card,
  CardSkeleton,
  Headline,
  LoadError,
  Segmented,
} from "./parts"

const STORAGE_KEY = "beautytop:my-shop"

type SavedShop = WatchedShop

function useMyShop() {
  const [shop, setShop] = useState<SavedShop | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setShop({ kind: "SHOP", ...JSON.parse(saved) })
    } catch {}
  }, [])

  return [shop, setShop] as const
}

export function WatchTab({
  onSelectShop,
}: {
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const [shop] = useMyShop()
  return <CompetitorsCard shop={shop} onSelectShop={onSelectShop} />
}

export function MyShopTab({
  onSelectShop,
}: {
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const [shop, setShop] = useMyShop()

  const choose = (next: SavedShop | null) => {
    setShop(next)
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      else localStorage.removeItem(STORAGE_KEY)
      if (next) {
        const located = Boolean(next.sido && next.gugun)
        localStorage.setItem(
          FILTERS_KEY,
          JSON.stringify({
            sido: located ? next.sido : DEFAULT_FILTERS.sido,
            gugun: located ? next.gugun : DEFAULT_FILTERS.gugun,
            category: next.category || DEFAULT_FILTERS.category,
          })
        )
      }
    } catch {}
  }

  if (!shop) return <ShopSearch onPick={choose} />
  return (
    <ShopReport
      shop={shop}
      onChange={() => choose(null)}
      onDetail={() => onSelectShop({ id: shop.id, kind: shop.kind })}
      onSelectShop={onSelectShop}
    />
  )
}

function ShopSearch({
  onPick,
  bare = false,
  exclude = [],
}: {
  onPick: (shop: SavedShop) => void
  bare?: boolean
  exclude?: string[]
}) {
  const t = useTranslations("beautytop")
  const fmt = useNumberFormats()
  const [input, setInput] = useState("")
  const [query, setQuery] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300)
    return () => clearTimeout(timer)
  }, [input])

  const search = useBeautyTop<BeautyTopSearch>(
    { resource: "search", search: query, page_size: 20 },
    query.length >= 2
  )

  const content = (
    <>
      <label className="bg-muted flex h-12 items-center gap-2 rounded-xl px-4">
        <Search aria-hidden className="text-muted-foreground h-5 w-5" />
        <span className="sr-only">{t("myShop.searchLabel")}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("myShop.searchPlaceholder")}
          className="text-foreground h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#b0b3ba]"
        />
      </label>

      {query.length < 2 ? (
        <p className="text-muted-foreground mt-4 text-[15px] break-keep">
          {t("myShop.searchHint")}
        </p>
      ) : search.isPending ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-14 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : search.isError ? (
        <LoadError onRetry={() => search.refetch()} />
      ) : search.data.items.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-[15px] break-keep">
          {t("myShop.noResult", { query })}
        </p>
      ) : (
        <ul className="mt-2">
          {search.data.items
            .filter(
              (item) => !exclude.includes(targetKey(item.entity_type, item.id))
            )
            .map((item) => (
              <li key={targetKey(item.entity_type, item.id)}>
                <button
                  type="button"
                  onClick={() =>
                    onPick({
                      id: item.id,
                      kind: item.entity_type,
                      name: item.name,
                      sido: item.sido,
                      gugun: item.gugun,
                      category: item.category,
                    })
                  }
                  className="hover:bg-muted -mx-2 flex w-[calc(100%+16px)] items-center justify-between gap-3 rounded-xl px-2 py-3 text-left transition-colors duration-150"
                >
                  <span className="min-w-0">
                    <span className="text-foreground block truncate text-[17px] leading-[25.5px] font-medium">
                      {item.name}
                    </span>
                    <span className="text-muted-foreground block text-[13px]">
                      {[item.category, item.sido, item.gugun]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {item.visitor_reviews != null && (
                    <span className="text-muted-foreground shrink-0 text-[13px] tabular-nums">
                      {t("rank.reviews")} {fmt.full(item.visitor_reviews)}
                    </span>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}
    </>
  )

  return bare ? content : <Card>{content}</Card>
}

function ShopReport({
  shop,
  onChange,
  onDetail,
  onSelectShop,
}: {
  shop: SavedShop
  onChange: () => void
  onDetail: () => void
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const t = useTranslations("beautytop")

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 px-1 pb-1">
        <p className="text-foreground min-w-0 truncate text-[17px] font-bold">
          {shop.name}
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onDetail}
            className="bg-background text-foreground h-9 rounded-lg px-3 text-[13px] font-medium"
          >
            {t("myShop.detail")}
          </button>
          <button
            type="button"
            onClick={onChange}
            className="bg-background text-foreground h-9 rounded-lg px-3 text-[13px] font-medium"
          >
            {t("myShop.change")}
          </button>
        </div>
      </div>
      <PositionCard shop={shop} />
      <PeersCard shop={shop} />
      <CompetitorsCard shop={shop} onSelectShop={onSelectShop} />
    </div>
  )
}

function PositionCard({ shop }: { shop: SavedShop }) {
  const t = useTranslations("beautytop")
  const fmt = useNumberFormats()
  const [sort, setSort] = useState<"reviews" | "followers">("reviews")
  const position = useBeautyTop<BeautyTopPosition>({
    resource: "position",
    id: shop.id,
    kind: shop.kind,
    sort,
  })

  if (position.isPending) return <CardSkeleton />
  if (position.isError)
    return (
      <Card>
        <LoadError onRetry={() => position.refetch()} />
      </Card>
    )
  const ranks = position.data.available ? (position.data.ranks ?? []) : []
  if (ranks.length === 0) return null

  const local = ranks[ranks.length - 1]
  const topPct = (r: { rank: number; total: number }) =>
    Math.max(1, Math.ceil((r.rank / r.total) * 100))

  return (
    <Card note={t("myShop.note")}>
      <Headline eyebrow={t("myShop.positionEyebrow", { name: shop.name })}>
        {t.rich("myShop.positionHeadline", {
          scope: local.label,
          rank: fmt.full(local.rank),
          b: (chunks) => <Big>{chunks}</Big>,
        })}
      </Headline>
      <p className="text-muted-foreground mt-2 text-[15px] tabular-nums">
        {t("myShop.positionSub", {
          total: fmt.full(local.total),
          pct: topPct(local),
        })}
      </p>
      <Segmented
        className="mt-4"
        value={sort}
        onChange={setSort}
        options={[
          { value: "reviews", label: t("rank.byReviews") },
          { value: "followers", label: t("rank.byFollowers") },
        ]}
      />
      <ul className="mt-4 space-y-4">
        {[...ranks].reverse().map((r) => {
          return (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-[15px]">
                <span className="text-foreground font-medium">{r.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  <strong className="text-foreground">
                    {fmt.full(r.rank)}
                  </strong>{" "}
                  / {fmt.full(r.total)}
                </span>
              </div>
              <div className="bg-secondary mt-2 h-1.5 rounded-full">
                <div
                  className="bg-primary h-full rounded-full"
                  style={{ width: `${(1 - (r.rank - 1) / r.total) * 100}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function PeersCard({ shop }: { shop: SavedShop }) {
  const t = useTranslations("beautytop")
  const briefing = useBeautyTop<BeautyTopBriefing>({
    resource: "briefing",
    id: shop.id,
    kind: shop.kind,
  })

  if (briefing.isPending) return <CardSkeleton />
  if (briefing.isError)
    return (
      <Card>
        <LoadError onRetry={() => briefing.refetch()} />
      </Card>
    )

  const peers = briefing.data.peers
  const metrics = (peers?.available ? peers.metrics : []).filter(
    (m) =>
      m.status === "READY" &&
      m.current != null &&
      m.median != null &&
      ["reviews", "followers", "price"].includes(m.key)
  )
  const serviceName =
    peers?.services.find((s) => s.id === peers.service)?.name ?? ""

  return (
    <>
      {peers && metrics.length > 0 && (
        <Card>
          <Headline
            eyebrow={t("myShop.peersEyebrow", { count: peers.peer_count })}
          >
            {peers.criteria.join(" · ")}
          </Headline>
          <ul className="mt-4 space-y-3">
            {metrics.map((m) => (
              <PeerRow
                key={m.key}
                metric={m}
                label={
                  m.key === "price"
                    ? t("myShop.priceLabel", { service: serviceName })
                    : t(m.key === "reviews" ? "shop.reviews" : "shop.followers")
                }
              />
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

function PeerRow({
  metric,
  label,
}: {
  metric: BeautyTopPeerMetric
  label: string
}) {
  const t = useTranslations("beautytop")
  const fmt = useNumberFormats()
  const current = metric.current ?? 0
  const median = metric.median ?? 0
  const isPrice = metric.key === "price"
  const value = (n: number) =>
    isPrice ? t("unit.won", { value: fmt.full(n) }) : fmt.full(Math.round(n))
  const diff = Math.round(Math.abs(current - median))
  const same = median === 0 || diff / median < 0.03
  const verdict = same
    ? t("myShop.same")
    : isPrice
      ? t(current > median ? "myShop.higher" : "myShop.lower", {
          diff: value(diff),
        })
      : t(current > median ? "myShop.more" : "myShop.fewer", {
          diff: fmt.full(diff),
        })

  return (
    <li className="bg-muted rounded-xl p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-foreground text-[17px] leading-[25.5px] font-medium">
          {label}
        </span>
        <span className="text-foreground text-[17px] font-bold">{verdict}</span>
      </div>
      <div className="text-muted-foreground mt-1 flex justify-between text-[13px] tabular-nums">
        <span>
          {t("myShop.mine")} {value(current)} · {t("myShop.typical")}{" "}
          {value(median)}
        </span>
        {metric.rank != null && metric.rank_total != null && (
          <span>
            {t("myShop.peersRank", {
              rank: metric.rank,
              total: metric.rank_total,
            })}
          </span>
        )}
      </div>
    </li>
  )
}

function CompetitorsCard({
  shop,
  onSelectShop,
}: {
  shop: SavedShop | null
  onSelectShop: (target: BeautyTopTarget) => void
}) {
  const t = useTranslations("beautytop")
  const fmt = useNumberFormats()
  const watchlist = useWatchlist()
  const rivals = watchlist.list.filter(
    (r) => !shop || targetKey(r.kind, r.id) !== targetKey(shop.kind, shop.id)
  )
  const [adding, setAdding] = useState(false)

  const targets = [...(shop ? [shop] : []), ...rivals]
    .map((s) => targetKey(s.kind, s.id))
    .join(",")
  const isMine = (row: BeautyTopShopSummary) =>
    shop != null && row.id === shop.id && row.entity_type === shop.kind

  const watch = useBeautyTop<BeautyTopWatch>(
    { resource: "watch", targets },
    rivals.length > 0
  )
  const changes = useBeautyTop<BeautyTopChanges>(
    { resource: "changes", targets, days: "30" },
    rivals.length > 0
  )
  const rows = [...(watch.data?.items ?? [])].sort(
    (a, b) => (b.visitor_reviews ?? -1) - (a.visitor_reviews ?? -1)
  )
  const myRank = rows.findIndex(isMine) + 1
  const events = changes.data?.events ?? []

  return (
    <Card note={t("myShop.note")}>
      <Headline eyebrow={t(shop ? "rivals.eyebrow" : "watch.eyebrow")}>
        {rivals.length === 0
          ? t(shop ? "rivals.emptyHeadline" : "watch.emptyHeadline")
          : myRank > 0
            ? t.rich("rivals.headline", {
                count: rows.length,
                rank: myRank,
                b: (chunks) => <Big>{chunks}</Big>,
              })
            : t.rich("watch.headline", {
                count: rivals.length,
                b: (chunks) => <Big>{chunks}</Big>,
              })}
      </Headline>

      {rivals.length > 0 &&
        (watch.isPending ? (
          <div className="bg-muted mt-4 h-40 animate-pulse rounded-xl" />
        ) : watch.isError ? (
          <LoadError onRetry={() => watch.refetch()} />
        ) : (
          <table className="mt-4 w-full table-fixed text-[15px] tabular-nums">
            <thead>
              <tr className="text-muted-foreground text-[13px]">
                <th className="pb-2 text-left font-normal">
                  {t("rivals.shop")}
                </th>
                <th className="w-16 pb-2 text-right font-normal">
                  {t("rank.reviews")}
                </th>
                <th className="w-16 pb-2 text-right font-normal">
                  {t("rank.followers")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((row) => {
                const mine = isMine(row)
                return (
                  <tr
                    key={targetKey(row.entity_type, row.id)}
                    className={cn(mine && "font-bold")}
                  >
                    <td className="py-3 pr-2">
                      <button
                        type="button"
                        onClick={() =>
                          onSelectShop({ id: row.id, kind: row.entity_type })
                        }
                        className="text-foreground block w-full truncate text-left"
                      >
                        {mine ? `${row.name} · ${t("myShop.mine")}` : row.name}
                      </button>
                    </td>
                    <td className="text-foreground py-3 text-right">
                      {row.visitor_reviews == null
                        ? "–"
                        : fmt.full(row.visitor_reviews)}
                    </td>
                    <td className="text-foreground py-3 pl-3 text-right">
                      {row.followers == null ? "–" : fmt.compact(row.followers)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ))}

      {events.length > 0 && (
        <>
          <p className="text-foreground mt-6 text-[15px] font-medium">
            {t("rivals.changes")}
          </p>
          <ul className="mt-2 space-y-2">
            {events.slice(0, 8).map((event, index) => (
              <li
                key={`${targetKey(event.brand.entity_type, event.brand.id)}-${event.type}-${index}`}
                className="bg-muted flex items-baseline justify-between gap-3 rounded-xl px-4 py-3 text-[15px]"
              >
                <span className="min-w-0">
                  <span className="text-foreground block truncate font-medium">
                    {event.brand.name}
                  </span>
                  <span className="text-muted-foreground block text-[13px]">
                    {event.label}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 font-bold tabular-nums",
                    (event.delta ?? 0) < 0
                      ? "text-muted-foreground"
                      : "text-foreground"
                  )}
                >
                  {(event.delta ?? 0) > 0 ? "▲" : "▼"}{" "}
                  {fmt.full(Math.abs(event.delta ?? 0))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {rivals.length > 0 && (
        <div className="scrollbar-hide -mx-6 mt-4 flex gap-2 overflow-x-auto px-6">
          {rivals.map((rival) => (
            <button
              key={targetKey(rival.kind, rival.id)}
              type="button"
              onClick={() => watchlist.remove(rival)}
              className="bg-secondary text-foreground h-8 shrink-0 rounded-full px-3 text-[13px] font-medium"
              aria-label={t("rivals.remove", { name: rival.name })}
            >
              {rival.name} ✕
            </button>
          ))}
        </div>
      )}

      {adding ? (
        <div className="mt-4">
          <ShopSearch
            bare
            exclude={[...(shop ? [shop] : []), ...rivals].map((r) =>
              targetKey(r.kind, r.id)
            )}
            onPick={(picked) => {
              watchlist.add(picked)
              setAdding(false)
            }}
          />
        </div>
      ) : (
        !watchlist.full && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="bg-secondary text-foreground mt-4 h-11 w-full rounded-xl text-[15px] font-medium"
          >
            {t(shop ? "rivals.add" : "watch.add")}
          </button>
        )
      )}
    </Card>
  )
}
