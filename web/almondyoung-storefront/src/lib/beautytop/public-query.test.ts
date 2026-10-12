import { generateKeyPairSync } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }))
import { MAX_BATCH, fetchFromSource, isPublicResource, normalizePublicQuery, queryPublicBatch } from "./public-query"

describe("BeautyTop public query", () => {
  it("exposes area aggregates only, never shop-level resources", () => {
    for (const resource of ["options", "market", "lifecycle", "revenue", "trends", "prices"]) {
      expect(isPublicResource(resource)).toBe(true)
    }
    for (const resource of ["shops", "search", "ranking", "operating", "price-comparison", "activity", "leaders",
      "shop", "position", "briefing", "changes", "watch", "franchise", "analysis", "map", "toString", "__proto__"]) {
      expect(isPublicResource(resource)).toBe(false)
    }
  })
  it("keeps only the filters each resource allows, in a stable order", () => {
    expect(normalizePublicQuery("market", { category: "네일", sido: "서울", gugun: "마포구", id: "1", resource: "market" }))
      .toEqual({ sido: "서울", gugun: "마포구", category: "네일" })
    expect(Object.keys(normalizePublicQuery("prices", { service: "hand_gel", category: "네일", sido: "서울" }) ?? {}))
      .toEqual(["sido", "category", "service"])
    expect(normalizePublicQuery("options", { sido: "서울" })).toEqual({})
  })
  it("rejects a district without its city and oversized values", () => {
    expect(normalizePublicQuery("market", { gugun: "마포구" })).toBeNull()
    expect(normalizePublicQuery("market", { sido: "x".repeat(41) })).toBeNull()
  })
})

describe("BeautyTop server calls to the source", () => {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it("keeps at most two requests in flight per subject and retries BUSY", async () => {
    vi.stubEnv("BEAUTYTOP_SIGNING_PRIVATE_KEY", key)
    vi.stubEnv("BEAUTYTOP_API_ORIGIN", "https://api.example.test")
    let running = 0
    let peak = 0
    let calls = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      const n = ++calls
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      // The first call is refused once to exercise the retry.
      if (n === 1) return Response.json({ error: { code: "BUSY" } }, { status: 429 })
      return Response.json({ data: { ok: true } })
    }))
    const results = await Promise.all(
      ["market", "lifecycle", "prices", "trends", "revenue"].map((r) => fetchFromSource(r, {}, "test-subject"))
    )
    expect(peak).toBeLessThanOrEqual(2)
    expect(results.every((r) => r.ok)).toBe(true)
    expect(calls).toBe(6)
  })
  it("answers a batch item by item and never reaches the source for invalid items", async () => {
    const results = await queryPublicBatch(["resource=shops", "resource=market&gugun=마포구"])
    expect(results).toEqual([
      { ok: false, error: "INVALID_QUERY" },
      { ok: false, error: "INVALID_QUERY" },
    ])
  })
  it("lets a whole page's public aggregates use the dedicated eight-slot pool", async () => {
    vi.stubEnv("BEAUTYTOP_SIGNING_PRIVATE_KEY", key)
    vi.stubEnv("BEAUTYTOP_API_ORIGIN", "https://api.example.test")
    let running = 0
    let peak = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return Response.json({ data: { ok: true } })
    }))
    const area = "sido=서울&gugun=강서구&category=반영구"
    const results = await queryPublicBatch([
      "resource=options",
      `resource=market&${area}`,
      `resource=lifecycle&${area}`,
      `resource=revenue&${area}`,
      `resource=trends&${area}`,
      `resource=prices&${area}&service=basic`,
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(peak).toBe(6)
  })
  it.each([
    ["almondyoung-server:public", 8],
    ["almondyoung-server:teaser", 2],
    ["almondyoung-server.public", 2],
  ])("bounds source concurrency for %s at %i", async (subject, maximum) => {
    vi.stubEnv("BEAUTYTOP_SIGNING_PRIVATE_KEY", key)
    vi.stubEnv("BEAUTYTOP_API_ORIGIN", "https://api.example.test")
    let running = 0
    let peak = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return Response.json({ data: { ok: true } })
    }))
    const results = await Promise.all(Array.from({ length: 12 }, () => fetchFromSource("market", {}, subject)))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(peak).toBe(maximum)
  })
  it.each(["5", "Wed, 07 Oct 2026 08:00:05 GMT"])("honors Retry-After %s before retrying", async (header) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-07T08:00:00Z"))
    vi.stubEnv("BEAUTYTOP_SIGNING_PRIVATE_KEY", key)
    vi.stubEnv("BEAUTYTOP_API_ORIGIN", "https://api.example.test")
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "BUSY" } }, { status: 503, headers: { "Retry-After": header } }))
      .mockResolvedValue(Response.json({ data: { ok: true } }))
    vi.stubGlobal("fetch", fetch)
    const result = fetchFromSource("market", {})
    await vi.advanceTimersByTimeAsync(4999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it("hands a wait longer than the budget back to the caller instead of retrying early", async () => {
    vi.stubEnv("BEAUTYTOP_SIGNING_PRIVATE_KEY", key)
    vi.stubEnv("BEAUTYTOP_API_ORIGIN", "https://api.example.test")
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: "RATE_LIMITED" } }, {
      status: 429, headers: { "Retry-After": "60" },
    }))
    vi.stubGlobal("fetch", fetch)
    expect(await fetchFromSource("market", {})).toEqual({ ok: false, error: "BUSY", retryAfterMs: 60_000 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("caps cumulative retry waits and passes the last wait on", async () => {
    vi.useFakeTimers()
    vi.stubEnv("BEAUTYTOP_SIGNING_PRIVATE_KEY", key)
    vi.stubEnv("BEAUTYTOP_API_ORIGIN", "https://api.example.test")
    const fetch = vi.fn(async () => Response.json({ error: { code: "BUSY" } }, {
      status: 503, headers: { "Retry-After": "5" },
    }))
    vi.stubGlobal("fetch", fetch)
    const result = fetchFromSource("market", {})
    await vi.advanceTimersByTimeAsync(10000)
    expect(await result).toEqual({ ok: false, error: "BUSY", retryAfterMs: 5000 })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it("stops waiting before the server function would be cut off", async () => {
    vi.useFakeTimers()
    vi.stubEnv("BEAUTYTOP_SIGNING_PRIVATE_KEY", key)
    vi.stubEnv("BEAUTYTOP_API_ORIGIN", "https://api.example.test")
    const fetch = vi.fn(async () => {
      // A slow first answer leaves too little of the deadline for the advised wait.
      await new Promise((resolve) => setTimeout(resolve, 12_000))
      return Response.json({ error: { code: "BUSY" } }, { status: 503, headers: { "Retry-After": "4" } })
    })
    vi.stubGlobal("fetch", fetch)
    const result = fetchFromSource("market", {})
    await vi.advanceTimersByTimeAsync(12_000)
    expect(await result).toEqual({ ok: false, error: "BUSY", retryAfterMs: 4000 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("keeps each batch item's own wait", async () => {
    vi.stubEnv("BEAUTYTOP_SIGNING_PRIVATE_KEY", key)
    vi.stubEnv("BEAUTYTOP_API_ORIGIN", "https://api.example.test")
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      new URL(String(input)).searchParams.get("resource") === "lifecycle"
        ? Response.json({ error: { code: "RATE_LIMITED" } }, { status: 429, headers: { "Retry-After": "60" } })
        : Response.json({ data: { ok: true } })
    ))
    const area = "sido=서울&gugun=강남구&category=속눈썹"
    const results = await queryPublicBatch([`resource=market&${area}`, `resource=lifecycle&${area}`])
    expect(results[0]).toEqual({ ok: true, data: { ok: true } })
    expect(results[1]).toEqual({ ok: false, error: "BUSY", retryAfterMs: 60_000 })
  })
  it("caps a batch", async () => {
    const results = await queryPublicBatch(Array.from({ length: MAX_BATCH + 3 }, () => "resource=shops"))
    expect(results).toHaveLength(MAX_BATCH)
  })
})
