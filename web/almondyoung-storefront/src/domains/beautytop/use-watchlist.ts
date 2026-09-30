"use client"

import { useMemo, useSyncExternalStore } from "react"
import { type BeautyTopShopSummary, type BeautyTopTarget, targetKey } from "./types"

const KEY = "beautytop:rivals"
const EVENT = "beautytop:watchlist"
export const MAX_WATCH = 7

export type WatchedShop = BeautyTopTarget &
  Pick<BeautyTopShopSummary, "name"> &
  Partial<Pick<BeautyTopShopSummary, "sido" | "gugun" | "category">>

function read() {
  try {
    return localStorage.getItem(KEY) ?? "[]"
  } catch {
    return "[]"
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

function parse(raw: string): WatchedShop[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export function useWatchlist() {
  const raw = useSyncExternalStore(subscribe, read, () => "[]")
  const list = useMemo(() => parse(raw), [raw])

  const save = (next: WatchedShop[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {}
    window.dispatchEvent(new Event(EVENT))
  }
  const same = (a: BeautyTopTarget, b: BeautyTopTarget) =>
    targetKey(a.kind, a.id) === targetKey(b.kind, b.id)

  return {
    list,
    full: list.length >= MAX_WATCH,
    has: (target: BeautyTopTarget) => list.some((s) => same(s, target)),
    add: (shop: WatchedShop) => {
      if (list.length < MAX_WATCH && !list.some((s) => same(s, shop)))
        save([...list, shop])
    },
    remove: (target: BeautyTopTarget) =>
      save(list.filter((s) => !same(s, target))),
  }
}
