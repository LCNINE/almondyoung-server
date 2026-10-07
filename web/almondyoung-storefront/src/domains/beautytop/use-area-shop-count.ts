"use client"

import { useEffect, useState } from "react"
import { useScopeFilters } from "./components/neighborhood-tab"
import type { BeautyTopMarket } from "./types"
import { useArea } from "./use-area"

/** Shop count for the visitor's saved area from the public cache; null until there is a real, non-zero count. */
export function useAreaShopCount() {
  const [filters] = useScopeFilters()
  // The saved area is read in an effect; asking before it lands would fetch the default area for nothing.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const market = useArea<BeautyTopMarket>("market", filters, ready)
  const shops = market.data?.available ? (market.data.shops ?? 0) : 0
  return { filters, shops: shops > 0 ? shops : null }
}
