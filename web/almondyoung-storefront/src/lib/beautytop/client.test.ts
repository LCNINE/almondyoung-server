import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { acknowledgePremiumUse, BeautyTopError, forgetBeautyTopToken, queryBeautyTop } from "./client"

const proof = { access_token: "t1", api_base_url: "https://api.example.test", expires_in: 120 }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

function server(tokenStatuses: number[] = [], queryStatuses: number[] = []) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith("/api/beautytop/token")) {
      const status = tokenStatuses.shift() ?? 200
      return status === 200 ? json(200, proof) : json(status, { error: "X", withdrawalDaysRemaining: 5 })
    }
    if (url.startsWith("/api/auth/restore-token")) return json(401, {})
    const status = queryStatuses.shift() ?? 200
    return json(status, { api_version: "1", resource: "market", data: { ok: true }, pagination: null })
  })
  vi.stubGlobal("fetch", fetchMock)
  return { calls, tokenCalls: () => calls.filter((c) => c.startsWith("/api/beautytop/token")) }
}

describe("BeautyTop browser client", () => {
  beforeEach(() => forgetBeautyTopToken())
  afterEach(() => vi.unstubAllGlobals())
  it("uses session credentials only for same-origin proof and bearer only for the API", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "synthetic-proof", api_base_url: "https://api.example.test", expires_in: 120 }))
      .mockResolvedValueOnce(Response.json({ api_version: "1", data: { items: [] }, pagination: null }))
    vi.stubGlobal("fetch", fetch)
    await queryBeautyTop({ resource: "shops", page: 2, page_size: 20, sido: "경기" })
    expect(fetch.mock.calls[0][0]).toBe("/api/beautytop/token")
    expect(fetch.mock.calls[0][1].credentials).toBe("same-origin")
    const [url, init] = fetch.mock.calls[1]
    expect(url.searchParams.get("page")).toBe("2")
    expect(url.searchParams.get("sido")).toBe("경기")
    expect(url.search).not.toContain("synthetic-proof")
    expect(init.credentials).toBe("omit")
    expect(init.redirect).toBe("error")
    expect(init.headers.Authorization).toBe("Bearer synthetic-proof")
  })
  it("retries when the API is busy", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "synthetic-proof", api_base_url: "https://api.example.test", expires_in: 120 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "BUSY" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ api_version: "1", data: { items: [] }, pagination: null }))
    vi.stubGlobal("fetch", fetch)
    await expect(queryBeautyTop({ resource: "market" })).resolves.toMatchObject({ data: { items: [] } })
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it("renews an expired login once before issuing the proof", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({ access_token: "synthetic-proof", api_base_url: "https://api.example.test", expires_in: 120 }))
      .mockResolvedValueOnce(Response.json({ api_version: "1", data: { items: [] }, pagination: null }))
    vi.stubGlobal("fetch", fetch)
    await expect(queryBeautyTop({ resource: "shops" })).resolves.toMatchObject({ data: { items: [] } })
    expect(fetch.mock.calls[1][0]).toBe("/api/auth/restore-token")
  })
  it("does not call the data API when session verification fails", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
    vi.stubGlobal("fetch", fetch)
    await expect(queryBeautyTop({ resource: "shops" })).rejects.toMatchObject({ code: "LOGIN_REQUIRED" })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it("does not send a proof to an HTTP endpoint", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "synthetic-proof", api_base_url: "http://api.example.test", expires_in: 120 }))
    vi.stubGlobal("fetch", fetch)
    await expect(queryBeautyTop({ resource: "shops" })).rejects.toMatchObject({ code: "FAILED" })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe("BeautyTop client", () => {
  beforeEach(() => forgetBeautyTopToken())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("reuses one token across queries until shortly before it expires", async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const s = server()
    for (let i = 0; i < 5; i++) await queryBeautyTop({ resource: "market" })
    expect(s.tokenCalls()).toHaveLength(1)
    vi.setSystemTime(1_000_000 + 109_000)
    await queryBeautyTop({ resource: "market" })
    expect(s.tokenCalls()).toHaveLength(1)
    vi.setSystemTime(1_000_000 + 111_000)
    await queryBeautyTop({ resource: "market" })
    expect(s.tokenCalls()).toHaveLength(2)
  })

  it("replaces a rejected token once", async () => {
    const s = server([], [401, 200])
    await expect(queryBeautyTop({ resource: "market" })).resolves.toMatchObject({ data: { ok: true } })
    expect(s.tokenCalls()).toHaveLength(2)
  })

  it.each([
    [401, "LOGIN_REQUIRED"],
    [403, "MEMBERSHIP_REQUIRED"],
    [409, "CONFIRMATION_REQUIRED"],
    [429, "RATE_LIMITED"],
    [503, "UNAVAILABLE"],
  ])("turns token status %i into %s for the screen to translate", async (status, code) => {
    server([status])
    const error = await queryBeautyTop({ resource: "market" }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BeautyTopError)
    expect((error as BeautyTopError).code).toBe(code)
  })

  it("acknowledges with the one fixed query and keeps that token", async () => {
    const s = server([409, 200])
    await expect(queryBeautyTop({ resource: "market" })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED", withdrawalDaysRemaining: 5 })
    await acknowledgePremiumUse()
    await queryBeautyTop({ resource: "market" })
    expect(s.tokenCalls()).toEqual(["/api/beautytop/token", "/api/beautytop/token?acknowledged=1"])
  })
})
