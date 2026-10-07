import { describe, expect, it, vi } from "vitest"

vi.mock("../../../../lib/beautytop/public-query", () => ({
  MAX_BATCH: 8,
  isPublicResource: () => true,
  queryPublic: async () => ({ ok: false, error: "BUSY", retryAfterMs: 60_000 }),
  queryPublicBatch: async () => [
    { ok: true, data: { shops: 1 } },
    { ok: false, error: "BUSY", retryAfterMs: 4_200 },
    { ok: false, error: "SOURCE_UNAVAILABLE" },
  ],
}))

import { GET as batch } from "./batch/route"
import { GET as single } from "./route"

describe("area routes pass the source's wait on", () => {
  it("tells the browser when a single aggregate may be asked again", async () => {
    const response = await single(new Request("http://x/api/beautytop/area?resource=market"))
    expect(response.status).toBe(503)
    expect(response.headers.get("Retry-After")).toBe("60")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })

  it("keeps each batch item's wait, rounded up, and does not cache a partial batch", async () => {
    const response = await batch(new Request("http://x/api/beautytop/area/batch?q=a&q=b&q=c"))
    expect(await response.json()).toEqual({
      results: [{ data: { shops: 1 } }, { error: "BUSY", retryAfter: 5 }, { error: "SOURCE_UNAVAILABLE" }],
    })
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })
})
