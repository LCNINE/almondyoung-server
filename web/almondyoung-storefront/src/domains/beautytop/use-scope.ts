"use client"

import { useTranslations } from "next-intl"
import { useSyncExternalStore } from "react"
import {
  DEFAULT_FILTERS,
  FILTERS_KEY,
  parseScope,
  scopeFromSearch,
  type ScopeFilters,
} from "./scope"

const CHANGE_EVENT = "beautytop-scope-change"
let snapshot: ScopeFilters | undefined
let lastSearch: string | undefined

function getSnapshot(): ScopeFilters {
  if (lastSearch !== window.location.search) {
    lastSearch = window.location.search
    const linked = scopeFromSearch(lastSearch)
    if (linked) snapshot = linked
  }
  if (snapshot) return snapshot
  let saved: ScopeFilters | null = null
  try {
    saved = parseScope(JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "null"))
  } catch {}
  snapshot = saved ?? DEFAULT_FILTERS
  return snapshot
}

function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== FILTERS_KEY && event.key !== null) return
    snapshot = undefined
    notify()
  }
  window.addEventListener(CHANGE_EVENT, notify)
  window.addEventListener("storage", storage)
  window.addEventListener("popstate", notify)
  return () => {
    window.removeEventListener(CHANGE_EVENT, notify)
    window.removeEventListener("storage", storage)
    window.removeEventListener("popstate", notify)
  }
}

export function setScopeFilters(next: Partial<ScopeFilters>) {
  const filters = parseScope({ ...getSnapshot(), ...next })
  if (!filters) return
  snapshot = filters
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters))
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useScopeFilters() {
  const filters = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_FILTERS
  )
  return [filters, setScopeFilters] as const
}

export function useScopeLabel(filters: ScopeFilters) {
  const t = useTranslations("beautytop.scope")
  return (
    [filters.sido, filters.gugun].filter(Boolean).join(" ") || t("national")
  )
}
