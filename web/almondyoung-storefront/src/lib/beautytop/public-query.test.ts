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
  it("paces a whole page's batch to two requests at the source", async () => {
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
    expect(peak).toBe(2)
  })
  it("caps a batch", async () => {
    const results = await queryPublicBatch(Array.from({ length: MAX_BATCH + 3 }, () => "resource=shops"))
    expect(results).toHaveLength(MAX_BATCH)
  })
})
