import "server-only"

import { unstable_cache } from "next/cache"
import { fetchFromSource, type PublicQueryResult } from "./public-query"
import type { TeaserShop, TeaserSummary } from "./teaser-types"

export type { TeaserShop, TeaserSummary }

// A signed-in visitor without membership sees how many places and how many metrics a
// shop is measured against — never the rank, the values or the names of the other shops.
// Only these summaries are cached: raw shop-level rows never sit in a shared cache.

// Separate subject so a burst of previews cannot use up the public area cache's budget.
const TEASER_SUBJECT = "almondyoung-server:teaser"


type Metric = {
  key?: unknown
  current?: unknown
  median?: unknown
  order?: unknown
  status?: unknown
}

export function normalizeSearchTerm(value: string | null): string | null {
  const term = value?.trim() ?? ""
  return term.length >= 2 && term.length <= 40 ? term : null
}

export type SearchArea = { sido: string; gugun: string }

/** Searching nationwide buries a visitor's own shop under same-name shops elsewhere. */
export function normalizeSearchArea(sido: string | null, gugun: string | null): SearchArea | null {
  const a = sido?.trim() ?? ""
  const b = gugun?.trim() ?? ""
  return a && b && a.length <= 40 && b.length <= 40 ? { sido: a, gugun: b } : null
}

export function parseShopId(value: string | null): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null
  const id = Number(value)
  return id > 0 ? id : null
}

export function toTeaserShops(data: unknown): TeaserShop[] {
  const items = (data as { items?: unknown })?.items
  if (!Array.isArray(items)) return []
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .filter((item) => item.entity_type === "SHOP" && typeof item.id === "number" && typeof item.name === "string")
    .slice(0, 10)
    .map((item) => ({
      id: item.id as number,
      name: item.name as string,
      sido: typeof item.sido === "string" ? item.sido : "",
      gugun: typeof item.gugun === "string" ? item.gugun : "",
      category: typeof item.category === "string" ? item.category : "",
    }))
}

function classify(metric: Metric): keyof TeaserSummary["metrics"] {
  const { current, median } = metric
  if (metric.status !== "READY" || typeof current !== "number" || typeof median !== "number") return "unknown"
  // Price is a position, not a score: charging more is neither better nor worse.
  if (metric.key === "price") return "pricePosition"
  if (current === median) return "even"
  const lowerIsBetter = metric.order === "짧은 간격순"
  return current > median !== lowerIsBetter ? "ahead" : "behind"
}

/** Builds the counts-only preview. Anything not listed here must not reach a non-member. */
export function summarizeTeaser(briefing: unknown, position: unknown): TeaserSummary {
  const metrics = { ahead: 0, behind: 0, even: 0, pricePosition: 0, unknown: 0 }
  const peerMetrics = (briefing as { peers?: { metrics?: unknown } })?.peers?.metrics
  if (Array.isArray(peerMetrics)) {
    for (const metric of peerMetrics) metrics[classify((metric ?? {}) as Metric)]++
  }
  const ranks = (position as { ranks?: unknown })?.ranks
  const scopes = Array.isArray(ranks)
    ? ranks
        .filter((r): r is { label: string; total: number } =>
          !!r && typeof r.label === "string" && typeof r.total === "number")
        .map((r) => ({ label: r.label, total: r.total }))
    : []
  return { scopes, metrics }
}

class NotCacheable extends Error {
  constructor(readonly result: Exclude<PublicQueryResult, { ok: true }>) {
    super("not cacheable")
  }
}

type Ok<T> = { ok: true; data: T }
type Failed = Exclude<PublicQueryResult, { ok: true }>

const cachedSearch = unstable_cache(
  async (term: string, sido: string, gugun: string): Promise<Ok<TeaserShop[]>> => {
    const result = await fetchFromSource("shops", { search: term, sido, gugun, page_size: "10" }, TEASER_SUBJECT)
    if (!result.ok) throw new NotCacheable(result)
    return { ok: true, data: toTeaserShops(result.data) }
  },
  ["beautytop-teaser-search-v1"],
  { revalidate: 60 * 60, tags: ["beautytop-teaser"] }
)

const cachedSummary = unstable_cache(
  async (id: number): Promise<Ok<TeaserSummary>> => {
    const [briefing, position] = await Promise.all([
      fetchFromSource("briefing", { id: String(id) }, TEASER_SUBJECT),
      fetchFromSource("position", { id: String(id) }, TEASER_SUBJECT),
    ])
    if (!briefing.ok) throw new NotCacheable(briefing)
    if (!position.ok) throw new NotCacheable(position)
    return { ok: true, data: summarizeTeaser(briefing.data, position.data) }
  },
  ["beautytop-teaser-summary-v1"],
  { revalidate: 24 * 60 * 60, tags: ["beautytop-teaser"] }
)

const inFlight = new Map<string, Promise<Ok<unknown> | Failed>>()

function shared<T>(key: string, run: () => Promise<Ok<T>>): Promise<Ok<T> | Failed> {
  const running = inFlight.get(key) as Promise<Ok<T> | Failed> | undefined
  if (running) return running
  const task = run()
    .catch((error): Failed => (error instanceof NotCacheable ? error.result : { ok: false, error: "SOURCE_UNAVAILABLE" }))
    .finally(() => inFlight.delete(key))
  inFlight.set(key, task)
  return task
}

export const searchTeaserShops = (term: string, area: SearchArea) =>
  shared(`search:${area.sido}:${area.gugun}:${term}`, () => cachedSearch(term, area.sido, area.gugun))
export const getTeaserSummary = (id: number) => shared("summary:" + id, () => cachedSummary(id))
