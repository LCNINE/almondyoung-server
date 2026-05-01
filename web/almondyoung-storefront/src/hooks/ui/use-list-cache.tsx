"use client"

import { useEffect, useMemo, useRef } from "react"

export interface ListCacheSnapshot<T> {
  ts: number
  items?: T[]
  total: number
  currentPage: number
  scrollY: number
}

interface UseListCacheParams<T> {
  cacheKey: string
  ttlMs: number
  items: T[]
  total: number
  currentPage: number
  scrollYToRestore?: number
}

const memoryCache = new Map<string, ListCacheSnapshot<unknown>>()

const isFresh = (ts: number, ttlMs: number) => Date.now() - ts <= ttlMs

const parseSnapshot = <T,>(raw: string | null): ListCacheSnapshot<T> | null => {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<ListCacheSnapshot<T>>
    if (
      typeof parsed.ts !== "number" ||
      typeof parsed.total !== "number" ||
      typeof parsed.currentPage !== "number" ||
      typeof parsed.scrollY !== "number"
    ) {
      return null
    }

    return {
      ts: parsed.ts,
      items: Array.isArray(parsed.items) ? parsed.items : undefined,
      total: parsed.total,
      currentPage: parsed.currentPage,
      scrollY: parsed.scrollY,
    }
  } catch {
    return null
  }
}

export const getListCacheSnapshot = <T,>(
  cacheKey: string,
  ttlMs: number
): ListCacheSnapshot<T> | null => {
  if (ttlMs <= 0) {
    return null
  }

  const inMemory = memoryCache.get(cacheKey) as ListCacheSnapshot<T> | undefined
  if (inMemory) {
    if (isFresh(inMemory.ts, ttlMs)) {
      return inMemory
    }
    memoryCache.delete(cacheKey)
  }

  if (typeof window === "undefined") {
    return null
  }

  const fromSession = parseSnapshot<T>(window.sessionStorage.getItem(cacheKey))
  if (!fromSession) {
    return null
  }
  if (!isFresh(fromSession.ts, ttlMs)) {
    window.sessionStorage.removeItem(cacheKey)
    return null
  }

  memoryCache.set(cacheKey, fromSession as ListCacheSnapshot<unknown>)
  return fromSession
}

const setListCacheSnapshot = <T,>(cacheKey: string, snapshot: ListCacheSnapshot<T>) => {
  memoryCache.set(cacheKey, snapshot as ListCacheSnapshot<unknown>)
  if (typeof window === "undefined") {
    return
  }

  try {
    window.sessionStorage.setItem(cacheKey, JSON.stringify(snapshot))
  } catch {
    const minimal: ListCacheSnapshot<T> = {
      ts: snapshot.ts,
      total: snapshot.total,
      currentPage: snapshot.currentPage,
      scrollY: snapshot.scrollY,
    }
    memoryCache.set(cacheKey, minimal as ListCacheSnapshot<unknown>)
    try {
      window.sessionStorage.setItem(cacheKey, JSON.stringify(minimal))
    } catch {
      // sessionStorage quota 초과 시 메모리 캐시만 유지
    }
  }
}

export const useListCache = <T,>({
  cacheKey,
  ttlMs,
  items,
  total,
  currentPage,
  scrollYToRestore = 0,
}: UseListCacheParams<T>) => {
  const cacheSnapshot = useMemo(
    () => getListCacheSnapshot<T>(cacheKey, ttlMs),
    [cacheKey, ttlMs]
  )
  const restoreKeyRef = useRef<string>("")

  useEffect(() => {
    if (ttlMs <= 0) return
    if (scrollYToRestore <= 0) return
    if (restoreKeyRef.current === cacheKey) return

    restoreKeyRef.current = cacheKey
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollYToRestore, behavior: "auto" })
      })
    })
  }, [cacheKey, scrollYToRestore, ttlMs])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (ttlMs <= 0) return

    let rafId = 0
    const saveCache = (scrollY: number) => {
      setListCacheSnapshot<T>(cacheKey, {
        ts: Date.now(),
        items,
        total,
        currentPage,
        scrollY,
      })
    }

    const onScroll = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        saveCache(window.scrollY)
      })
    }

    window.addEventListener("scroll", onScroll, { passive: true })

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
      window.removeEventListener("scroll", onScroll)
      saveCache(window.scrollY)
    }
  }, [cacheKey, currentPage, items, total, ttlMs])

  return { cacheSnapshot }
}
