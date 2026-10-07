import "server-only"

import { unstable_cache } from "next/cache"
import { BEAUTYTOP_ORIGIN, mintToken } from "./member-token"

// Visitors never call BeautyTop directly for the public view. The server asks once
// per (resource, filters) and every visitor shares that answer, so traffic to the
// source stays proportional to distinct areas, not to visitors.
// unstable_cache instead of fetch's data cache: fetch keys include headers, and the
// Authorization token is new on every call, so a fetch cache would never hit.

const SERVER_SUBJECT = "almondyoung-server:public"
const REVALIDATE_SECONDS = 6 * 60 * 60

const AREA_FILTERS = ["sido", "gugun", "category"] as const

// Only aggregates are public. Shop-level rows stay behind the member token.
const PUBLIC_RESOURCES = {
  options: [] as readonly string[],
  market: AREA_FILTERS,
  lifecycle: AREA_FILTERS,
  revenue: AREA_FILTERS,
  trends: AREA_FILTERS,
  prices: [...AREA_FILTERS, "service"],
} as const

export type PublicResource = keyof typeof PUBLIC_RESOURCES

export type PublicQueryResult =
  | { ok: true; data: unknown }
  // retryAfterMs: the source's own wait hint, passed on when it was too long to wait out here.
  | { ok: false; error: "INVALID_QUERY" | "SOURCE_UNAVAILABLE" | "BUSY" | "NOT_CONFIGURED"; retryAfterMs?: number }

export function isPublicResource(value: string): value is PublicResource {
  return Object.prototype.hasOwnProperty.call(PUBLIC_RESOURCES, value)
}

export function normalizePublicQuery(
  resource: PublicResource,
  input: Record<string, string | undefined>
): Record<string, string> | null {
  const allowed: readonly string[] = PUBLIC_RESOURCES[resource]
  const params: Record<string, string> = {}
  for (const key of allowed) {
    const value = input[key]?.trim()
    if (!value) continue
    if (value.length > 40) return null
    params[key] = value
  }
  if (params.gugun && !params.sido) return null
  return params
}

function config() {
  return {
    privateKey: process.env.BEAUTYTOP_SIGNING_PRIVATE_KEY ?? "",
    apiOrigin: process.env.BEAUTYTOP_API_ORIGIN ?? "",
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

async function attemptSource(
  resource: string,
  params: Record<string, string>,
  subject: string,
  timeoutMs: number
): Promise<PublicQueryResult> {
  let token: ReturnType<typeof mintToken>
  try {
    token = mintToken(subject, config())
  } catch {
    return { ok: false, error: "NOT_CONFIGURED" } as const
  }
  const url = new URL("/v1/query", token.api_base_url)
  url.searchParams.set("resource", resource)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      // The source only accepts requests from our site origin.
      Origin: process.env.NODE_ENV === "production" ? BEAUTYTOP_ORIGIN : "http://localhost:8000",
    },
    cache: "no-store",
    redirect: "error",
    // Cold aggregates can take over ten seconds at the source; the answer is then cached for hours.
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.status === 429 || response.status === 503) {
    const body = await response.json().catch(() => null)
    return {
      ok: false,
      error: body?.error?.code === "SOURCE_UNAVAILABLE" ? "SOURCE_UNAVAILABLE" : "BUSY",
      retryAfterMs: retryAfterMs(response.headers.get("Retry-After")),
    } as const
  }
  if (!response.ok) return { ok: false, error: "SOURCE_UNAVAILABLE" } as const
  const body = await response.json()
  return { ok: true, data: body?.data ?? null } as const
}

// Match the source's dedicated public aggregate pool. Teasers and other subjects keep
// their existing two slots. This is per process; the source enforces the shared ceiling.
const MAX_PUBLIC_CONCURRENT = 8
const MAX_OTHER_CONCURRENT = 2
const BUSY_RETRY_MS = [400, 800, 1200]
const MAX_RETRY_DELAY_MS = 5000
const MAX_TOTAL_RETRY_DELAY_MS = 10000
// The server function is cut off at 20s; leave room to answer instead of being killed mid-wait.
const SOURCE_DEADLINE_MS = 15_000
const slots = new Map<string, { running: number; waiting: Array<() => void> }>()

async function withSlot<T>(subject: string, task: () => Promise<T>): Promise<T> {
  const slot = slots.get(subject) ?? { running: 0, waiting: [] }
  slots.set(subject, slot)
  const maximum = subject === SERVER_SUBJECT ? MAX_PUBLIC_CONCURRENT : MAX_OTHER_CONCURRENT
  if (slot.running < maximum) slot.running++
  else await new Promise<void>((resolve) => slot.waiting.push(resolve))
  try {
    return await task()
  } finally {
    const next = slot.waiting.shift()
    if (next) next()
    else slot.running--
  }
}

export async function fetchFromSource(
  resource: string,
  params: Record<string, string>,
  subject: string = SERVER_SUBJECT
): Promise<PublicQueryResult> {
  const deadline = Date.now() + SOURCE_DEADLINE_MS
  const attempt = () =>
    withSlot(subject, () => attemptSource(resource, params, subject, Math.max(1, deadline - Date.now())))
  let result = await attempt()
  let waited = 0
  for (const fallbackDelay of BUSY_RETRY_MS) {
    if (result.ok || result.error !== "BUSY") break
    const delay = Math.max(fallbackDelay, result.retryAfterMs ?? 0)
    // A minute-long rate window should return BUSY to the caller instead of holding
    // the request open or retrying before the source's Retry-After permits it.
    if (delay > MAX_RETRY_DELAY_MS || waited + delay > MAX_TOTAL_RETRY_DELAY_MS) break
    if (Date.now() + delay >= deadline) break
    waited += delay
    await new Promise((resolve) => setTimeout(resolve, delay))
    result = await attempt()
  }
  if (result.ok) return result
  // Only BUSY carries a wait; the caller must not ask again before the source said it may.
  return result.error === "BUSY" && result.retryAfterMs !== undefined
    ? { ok: false, error: "BUSY", retryAfterMs: result.retryAfterMs }
    : { ok: false, error: result.error }
}

class NotCacheable extends Error {
  constructor(readonly result: PublicQueryResult) {
    super("not cacheable")
  }
}

const cachedFetch = unstable_cache(
  async (resource: PublicResource, params: Record<string, string>) => {
    const result = await fetchFromSource(resource, params)
    // Failures must not be cached for six hours; throwing skips the cache write.
    if (!result.ok) throw new NotCacheable(result)
    return result
  },
  ["beautytop-public-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: ["beautytop-public"] }
)

// Visitors arriving together on a cold key share one source request.
const inFlight = new Map<string, Promise<PublicQueryResult>>()

export async function queryPublic(
  resource: PublicResource,
  input: Record<string, string | undefined>
): Promise<PublicQueryResult> {
  const params = normalizePublicQuery(resource, input)
  if (!params) return { ok: false, error: "INVALID_QUERY" }
  const key = resource + "?" + new URLSearchParams(params).toString()
  const running = inFlight.get(key)
  if (running) return running
  const task = cachedFetch(resource, params)
    .catch((error): PublicQueryResult =>
      error instanceof NotCacheable ? error.result : { ok: false, error: "SOURCE_UNAVAILABLE" }
    )
    .finally(() => inFlight.delete(key))
  inFlight.set(key, task)
  return task
}

// One page needs several aggregates at once. Asked as separate HTTP requests, each lands in
// its own serverless instance and the per-process slot above stops limiting anything, so
// the source sees all of them at once under one subject and answers BUSY. Batched, they share
// one instance and therefore the bounded public pool.
export const MAX_BATCH = 8

export async function queryPublicBatch(items: string[]): Promise<PublicQueryResult[]> {
  return Promise.all(
    items.slice(0, MAX_BATCH).map((item) => {
      const input = Object.fromEntries(new URLSearchParams(item))
      const resource = input.resource ?? ""
      if (!isPublicResource(resource)) return { ok: false, error: "INVALID_QUERY" } as const
      return queryPublic(resource, input)
    })
  )
}
