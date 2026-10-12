"use client"

import { useUser } from "@/contexts/user-context"
import {
  addWatchedBeautyTopShop,
  getSavedBeautyTopShops,
  removeWatchedBeautyTopShop,
  setMyBeautyTopShop,
  type SavedBeautyTopShops,
  type SavedShopsResult,
} from "@/lib/api/users/beautytop-shops"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useMemo } from "react"
import {
  planLocalMigration,
  toLocalShop,
  toServerShop,
} from "./saved-shops-migration"
import {
  type BeautyTopShopSummary,
  type BeautyTopTarget,
  targetKey,
} from "./types"

// Kept in the browser before shops were saved to the account; read once to move them, then removed.
const LEGACY_WATCH_KEY = "beautytop:rivals"
const LEGACY_MY_SHOP_KEY = "beautytop:my-shop"
export const MAX_WATCH = 7
const QUERY_KEY = ["beautytop-saved-shops"]

export type WatchedShop = BeautyTopTarget &
  Pick<BeautyTopShopSummary, "name"> &
  Partial<Pick<BeautyTopShopSummary, "sido" | "gugun" | "category">>

function readLegacy(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function useSavedShops() {
  const client = useQueryClient()
  const { user } = useUser()
  const queryKey = useMemo(() => [...QUERY_KEY, user?.id], [user?.id])
  const query = useQuery({
    queryKey,
    queryFn: () => getSavedBeautyTopShops(),
    staleTime: 60_000,
    enabled: !!user,
  })
  const migrated = useRef(false)

  useEffect(() => {
    if (!query.data || migrated.current) return
    migrated.current = true
    const plan = planLocalMigration(
      query.data,
      readLegacy(LEGACY_MY_SHOP_KEY),
      readLegacy(LEGACY_WATCH_KEY),
      MAX_WATCH
    )
    const clear = () => {
      try {
        localStorage.removeItem(LEGACY_MY_SHOP_KEY)
        localStorage.removeItem(LEGACY_WATCH_KEY)
      } catch {}
    }
    if (!plan) return clear()
    void (async () => {
      let latest: SavedShopsResult | null = null
      if (plan.myShop) latest = await setMyBeautyTopShop(plan.myShop)
      for (const shop of plan.watch)
        latest = await addWatchedBeautyTopShop(shop)
      if (latest?.ok) {
        client.setQueryData(queryKey, latest.data)
        clear()
      }
    })()
  }, [query.data, client, queryKey])

  const apply = async (result: Promise<SavedShopsResult>) => {
    const outcome = await result
    if (outcome.ok)
      client.setQueryData<SavedBeautyTopShops>(queryKey, outcome.data)
    return outcome
  }
  return { data: query.data, apply }
}

export function useWatchlist() {
  const { data, apply } = useSavedShops()
  const list: WatchedShop[] = (data?.watch ?? []).map(toLocalShop)
  const same = (a: BeautyTopTarget, b: BeautyTopTarget) =>
    targetKey(a.kind, a.id) === targetKey(b.kind, b.id)

  return {
    list,
    full: list.length >= MAX_WATCH,
    has: (target: BeautyTopTarget) => list.some((s) => same(s, target)),
    add: (shop: WatchedShop) =>
      apply(addWatchedBeautyTopShop(toServerShop(shop))),
    remove: (target: BeautyTopTarget) =>
      apply(removeWatchedBeautyTopShop(target.kind, target.id)),
  }
}

/** «내 샵». null 이면 아직 고르지 않았다. 불러오는 중에는 undefined. */
export function useMyShop() {
  const { data, apply } = useSavedShops()
  const shop: WatchedShop | null | undefined =
    data === undefined
      ? undefined
      : data.myShop
        ? toLocalShop(data.myShop)
        : null
  const choose = (next: WatchedShop | null) =>
    apply(setMyBeautyTopShop(next ? toServerShop(next) : null))
  return [shop, choose] as const
}
