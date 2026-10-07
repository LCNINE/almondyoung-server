import { describe, expect, it } from "vitest"
import { decodeBatchItem, encodeBatchItem } from "./batch-item"

const item = "resource=market&sido=서울&gugun=강남구&category=속눈썹"

// A hop on the way to the server function decodes the query string once more.
function throughExtraDecode(query: string) {
  return new URLSearchParams(decodeURIComponent(query)).getAll("q")
}

describe("batch item encoding", () => {
  it("round-trips Korean filters", () => {
    expect(decodeBatchItem(encodeBatchItem(item))).toBe(item)
  })

  it("keeps the filters inside the item even if the query is decoded once more", () => {
    const encoded = new URLSearchParams([["q", encodeBatchItem(item)]]).toString()
    expect(throughExtraDecode(encoded).map(decodeBatchItem)).toEqual([item])
  })

  it("would lose the filters with the item nested as a plain query string", () => {
    const nested = new URLSearchParams([["q", item]]).toString()
    expect(throughExtraDecode(nested)).toEqual(["resource=market"])
  })

  it("rejects values that are not an encoded item", () => {
    for (const value of ["", "resource=market", "%%%", "a".repeat(1001), encodeBatchItem("x").slice(0, 1) + "!"]) {
      expect(decodeBatchItem(value)).toBeNull()
    }
    expect(decodeBatchItem(btoa("\xff\xfe").replace(/=+$/, ""))).toBeNull()
  })
})
