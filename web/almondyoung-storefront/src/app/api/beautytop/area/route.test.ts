import { describe, expect, it, vi } from "vitest"
import { encodeBatchItem } from "../../../../lib/beautytop/batch-item"

const { received } = vi.hoisted(() => ({ received: [] as string[] }))

vi.mock("../../../../lib/beautytop/public-query", () => ({
  MAX_BATCH: 8,
  isPublicResource: () => true,
  queryPublic: async () => ({ ok: false, error: "BUSY", retryAfterMs: 60_000 }),
  queryPublicBatch: async (items: string[]) => {
    received.push(...items)
    return [{ ok: true, data: { shops: 1 } }, { ok: false, error: "BUSY", retryAfterMs: 4_200 }, { ok: false, error: "SOURCE_UNAVAILABLE" }]
  },
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
    const qs = new URLSearchParams([
      ["q", encodeBatchItem("resource=market&sido=서울&gugun=강남구&category=속눈썹")],
      ["q", encodeBatchItem("resource=options")],
      ["q", "not-encoded!"],
    ])
    const response = await batch(new Request(`http://x/api/beautytop/area/batch?${qs}`))
    expect(received).toEqual(["resource=market&sido=서울&gugun=강남구&category=속눈썹", "resource=options", ""])
    expect(await response.json()).toEqual({
      results: [{ data: { shops: 1 } }, { error: "BUSY", retryAfter: 5 }, { error: "SOURCE_UNAVAILABLE" }],
    })
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })
})
