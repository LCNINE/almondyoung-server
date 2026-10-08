import { z } from "zod"
import type { BeautyTopMarket, BeautyTopOptions } from "../types"

const marketSchema = z.object({
  available: z.boolean(),
  shops: z.number().int().nonnegative().optional(),
  opened_last_year: z.number().int().nonnegative().optional(),
  filters: z
    .object({ sido: z.string(), gugun: z.string(), category: z.string() })
    .optional(),
})

export function marketProvinces(options: BeautyTopOptions): string[] {
  return Array.from(
    new Set(options.regions.map((region) => region.sido).filter(Boolean))
  ).sort()
}

// Each bucket must describe exactly one requested province and the same category.
// Never present a partial sum as national, or average regional ratios/price medians.
export function sumProvinceMarkets(
  provinces: string[],
  category: string,
  responses: unknown[]
): BeautyTopMarket {
  if (
    !provinces.length ||
    new Set(provinces).size !== provinces.length ||
    responses.length !== provinces.length
  ) {
    throw new Error("INCOMPLETE_REGIONS")
  }
  const markets = responses.map((response, index) => {
    const market = marketSchema.parse(response)
    if (
      !market.available ||
      market.shops === undefined ||
      market.filters?.sido !== provinces[index] ||
      market.filters.gugun !== "" ||
      market.filters.category !== category
    ) {
      throw new Error("INCOMPLETE_REGIONS")
    }
    return market
  })
  const shops = markets.reduce((sum, market) => sum + (market.shops ?? 0), 0)
  const opened = markets.every(
    (market) => market.opened_last_year !== undefined
  )
    ? markets.reduce((sum, market) => sum + (market.opened_last_year ?? 0), 0)
    : undefined
  if (
    !Number.isSafeInteger(shops) ||
    (opened !== undefined && !Number.isSafeInteger(opened))
  ) {
    throw new Error("INVALID_TOTAL")
  }
  return { available: true, shops, opened_last_year: opened }
}
