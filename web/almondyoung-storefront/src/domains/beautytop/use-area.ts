"use client"

import { encodeBatchItem } from "@/lib/beautytop/batch-item"
import { useQuery } from "@tanstack/react-query"

type AreaResource = "options" | "market" | "lifecycle" | "trends" | "prices" | "revenue"

const MAX_BATCH = 8

export class AreaError extends Error {
  // retryAfterMs: the earliest the source allows this item to be asked again.
  constructor(
    readonly code: string,
    readonly retryAfterMs?: number
  ) {
    super(`area ${code}`)
  }
}

function retryAfterHeaderMs(value: string | null): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

type Pending = { item: string; resolve: (data: unknown) => void; reject: (error: unknown) => void }
let queue: Pending[] = []
let scheduled = false

async function flush() {
  scheduled = false
  const pending = queue
  queue = []
  for (let i = 0; i < pending.length; i += MAX_BATCH) {
    const chunk = pending.slice(i, i + MAX_BATCH)
    const search = new URLSearchParams()
    for (const p of chunk) search.append("q", encodeBatchItem(p.item))
    try {
      const response = await fetch(`/api/beautytop/area/batch?${search}`, { credentials: "omit" })
      if (!response.ok) {
        throw new AreaError(String(response.status), retryAfterHeaderMs(response.headers.get("Retry-After")))
      }
      const body = (await response.json()) as {
        results: ({ data: unknown } | { error: string; retryAfter?: number })[]
      }
      chunk.forEach((p, index) => {
        const result = body.results[index]
        if (result && "data" in result) p.resolve(result.data)
        else {
          const seconds = result?.retryAfter
          p.reject(new AreaError(result?.error ?? "SOURCE_UNAVAILABLE", typeof seconds === "number" ? seconds * 1000 : undefined))
        }
      })
    } catch (error) {
      for (const p of chunk) p.reject(error)
    }
  }
}

// Components ask for their aggregates independently; asks made in the same tick travel as
// one request so the server can pace them against the source's per-subject limit.
export function loadArea(resource: AreaResource, params: Record<string, string>) {
  const item = new URLSearchParams({ resource, ...params }).toString()
  return new Promise<unknown>((resolve, reject) => {
    queue.push({ item, resolve, reject })
    if (!scheduled) {
      scheduled = true
      setTimeout(flush, 0)
    }
  })
}

// Never earlier than the source allowed; each failed item keeps its own time even when the
// retries land in the same batch.
export function areaRetryDelay(attempt: number, error: unknown, jitter = Math.random()) {
  const spread = Math.floor(jitter * 500)
  if (error instanceof AreaError && error.retryAfterMs !== undefined) return error.retryAfterMs + spread
  return 1000 * 2 ** attempt + spread
}

// Neighbourhood aggregates come from our server cache, for members too: viewing them
// must not mint a member token (that would count as opening the premium benefit).
export function useArea<T>(resource: AreaResource, params: Record<string, string> = {}, enabled = true) {
  return useQuery({
    queryKey: ["beautytop-area", resource, params],
    queryFn: async () => (await loadArea(resource, params)) as T,
    staleTime: 5 * 60_000,
    // BUSY means the source is momentarily full, not that the answer is missing: ask again later.
    retry: (count, error) => (error instanceof AreaError && error.code === "BUSY" ? count < 3 : count < 1),
    retryDelay: (attempt, error) => areaRetryDelay(attempt, error),
    enabled,
  })
}
