import { afterEach, describe, expect, it, vi } from "vitest"
import { queryBeautyTop } from "./client"

describe("BeautyTop browser client", () => {
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
  it("does not call the data API when session verification fails", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 }))
    vi.stubGlobal("fetch", fetch)
    await expect(queryBeautyTop({ resource: "shops" })).rejects.toThrow("로그인이 필요합니다.")
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("does not send a proof to an HTTP endpoint", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "synthetic-proof", api_base_url: "http://api.example.test", expires_in: 120 }))
    vi.stubGlobal("fetch", fetch)
    await expect(queryBeautyTop({ resource: "shops" })).rejects.toThrow("주소")
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
