import { afterEach, describe, expect, it, vi } from "vitest"
import { AreaError, areaRetryDelay, loadArea } from "./use-area"

afterEach(() => vi.unstubAllGlobals())

describe("area batching", () => {
  it("sends asks made in the same tick as one request, in order", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({ results: [{ data: { shops: 3 } }, { data: { opened: 1 } }] })
    )
    vi.stubGlobal("fetch", fetchMock)

    const [market, lifecycle] = await Promise.all([
      loadArea("market", { sido: "서울", gugun: "마포구", category: "네일" }),
      loadArea("lifecycle", { sido: "서울", gugun: "마포구", category: "네일" }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://x")
    expect(url.pathname).toBe("/api/beautytop/area/batch")
    expect(url.searchParams.getAll("q").map((q) => new URLSearchParams(q).get("resource"))).toEqual(["market", "lifecycle"])
    expect(market).toEqual({ shops: 3 })
    expect(lifecycle).toEqual({ opened: 1 })
  })

  it("fails only the busy item, with a code the retry policy can read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [{ data: {} }, { error: "BUSY" }] })))

    const [ok, busy] = await Promise.allSettled([loadArea("options", {}), loadArea("market", { sido: "서울" })])

    expect(ok.status).toBe("fulfilled")
    expect(busy.status).toBe("rejected")
    const reason = busy.status === "rejected" ? busy.reason : null
    expect(reason).toBeInstanceOf(AreaError)
    expect(reason instanceof AreaError && reason.code).toBe("BUSY")
  })

  it("keeps the wait the server passed for an item", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [{ error: "BUSY", retryAfter: 60 }] })))
    const error = await loadArea("market", { sido: "서울" }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AreaError)
    expect(error instanceof AreaError && error.retryAfterMs).toBe(60_000)
  })

  it("never retries earlier than the source allowed", () => {
    expect(areaRetryDelay(0, new AreaError("BUSY", 60_000), 0)).toBe(60_000)
    expect(areaRetryDelay(2, new AreaError("BUSY", 5_000), 0.99)).toBeGreaterThanOrEqual(5_000)
    expect(areaRetryDelay(1, new AreaError("BUSY"), 0)).toBe(2_000)
  })
})
