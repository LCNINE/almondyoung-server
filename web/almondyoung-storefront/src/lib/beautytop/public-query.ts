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
  | { ok: false; error: "INVALID_QUERY" | "SOURCE_UNAVAILABLE" | "BUSY" | "NOT_CONFIGURED" }

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

async function attemptSource(resource: string, params: Record<string, string>, subject: string): Promise<PublicQueryResult> {
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
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 429 || response.status === 503) {
    const body = await response.json().catch(() => null)
    return { ok: false, error: body?.error?.code === "SOURCE_UNAVAILABLE" ? "SOURCE_UNAVAILABLE" : "BUSY" } as const
  }
  if (!response.ok) return { ok: false, error: "SOURCE_UNAVAILABLE" } as const
  const body = await response.json()
  return { ok: true, data: body?.data ?? null } as const
}

// The source answers BUSY beyond two concurrent requests per subject. This limit is per
// server process, so several instances can still exceed it — hence the short retries below.
const MAX_CONCURRENT_PER_SUBJECT = 2
const BUSY_RETRY_MS = [400, 800, 1200]
const slots = new Map<string, { running: number; waiting: Array<() => void> }>()

async function withSlot<T>(subject: string, task: () => Promise<T>): Promise<T> {
  const slot = slots.get(subject) ?? { running: 0, waiting: [] }
  slots.set(subject, slot)
  if (slot.running < MAX_CONCURRENT_PER_SUBJECT) slot.running++
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
  let result = await withSlot(subject, () => attemptSource(resource, params, subject))
  for (const delay of BUSY_RETRY_MS) {
    if (result.ok || result.error !== "BUSY") break
    await new Promise((resolve) => setTimeout(resolve, delay))
    result = await withSlot(subject, () => attemptSource(resource, params, subject))
  }
  return result
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
