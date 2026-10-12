import "server-only"

import { cache } from "react"
import { OPENING_SIDO } from "./opening-areas"
import { queryPublic } from "./public-query"

export type OpeningMonth = { month: string; opened: number; closed: number }

export type OpeningData = {
  shops: number
  opened: number | null
  closed: number | null
  residentsPerShop: number | null
  months: OpeningMonth[]
  otherCategories: { category: string; shops: number }[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)

// Reads only the public cache (the same answers the neighbourhood tab shares), so a page
// view never reaches the source on its own unless the cache window for that area expired.
export const getOpeningData = cache(async (gugun: string, category: string): Promise<OpeningData | null> => {
  const filters = { sido: OPENING_SIDO, gugun, category }
  const [market, lifecycle] = await Promise.all([queryPublic("market", filters), queryPublic("lifecycle", filters)])
  if (!market.ok || !isRecord(market.data) || market.data.available !== true) return null
  const shops = num(market.data.shops)
  if (shops === null || shops === 0) return null

  const life = lifecycle.ok && isRecord(lifecycle.data) && lifecycle.data.available === true ? lifecycle.data : null
  const months = Array.isArray(life?.monthly)
    ? life.monthly.flatMap((m): OpeningMonth[] => {
        if (!isRecord(m) || m.partial === true || typeof m.month !== "string") return []
        const opened = num(m.opened)
        const closed = num(m.closed)
        return opened === null || closed === null ? [] : [{ month: m.month, opened, closed }]
      })
    : []
  const categories = Array.isArray(market.data.categories)
    ? market.data.categories.flatMap((c) => {
        if (!isRecord(c) || typeof c.category !== "string") return []
        const count = num(c.shops)
        return count === null ? [] : [{ category: c.category, shops: count }]
      })
    : []

  return {
    shops,
    // The yearly opened count also comes with the market answer, so a category the permit
    // data does not separate still shows how many opened; closings stay unknown then.
    opened: num(life?.opened) ?? num(market.data.opened_last_year),
    closed: num(life?.closed),
    residentsPerShop: num(market.data.residents_per_shop),
    months,
    otherCategories: categories,
  }
})
