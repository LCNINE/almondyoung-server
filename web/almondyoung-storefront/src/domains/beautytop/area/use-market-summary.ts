"use client"

import { useQuery } from "@tanstack/react-query"
import { areaRetryDelay, AreaError, loadArea, useArea } from "../use-area"
import type { ScopeFilters } from "../scope"
import type { BeautyTopMarket, BeautyTopOptions } from "../types"
import { marketProvinces, sumProvinceMarkets } from "./national-market"

export async function loadNationalMarket(
  provinces: string[],
  category: string
) {
  const results = await Promise.allSettled(
    provinces.map((sido) => loadArea("market", { sido, category }))
  )
  const errors: unknown[] = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  )
  if (errors.length) {
    const terminal = errors.findIndex(
      (error) => !(error instanceof AreaError) || error.code !== "BUSY"
    )
    if (terminal >= 0) throw errors[terminal]
    // A single shared retry must respect every failed region's earliest retry time.
    const busy = errors.reduce<AreaError | undefined>((latest, error) => {
      if (!(error instanceof AreaError)) return latest
      return !latest || (error.retryAfterMs ?? 0) > (latest.retryAfterMs ?? 0)
        ? error
        : latest
    }, undefined)
    throw busy
  }
  const responses = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  )
  return sumProvinceMarkets(provinces, category, responses)
}

export function useMarketSummary(
  filters: ScopeFilters,
  options: BeautyTopOptions,
  enabled = true
) {
  const national = !filters.sido
  const regional = useArea<BeautyTopMarket>(
    "market",
    filters,
    enabled && !national
  )
  const provinces = marketProvinces(options)
  const summary = useQuery({
    queryKey: ["beautytop-area-national-market", filters.category, provinces],
    // Paced batches of eight through the existing public cache; shared by all consumers.
    queryFn: () => loadNationalMarket(provinces, filters.category),
    staleTime: 5 * 60_000,
    retry: (count, error) =>
      error instanceof AreaError && error.code === "BUSY" && count < 3,
    retryDelay: areaRetryDelay,
    enabled: enabled && national,
  })
  return national ? summary : regional
}
