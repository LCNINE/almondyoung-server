import { afterEach, describe, expect, it, vi } from "vitest"
import { decodeBatchItem } from "@/lib/beautytop/batch-item"
import { AreaError } from "../use-area"
import { loadNationalMarket } from "./use-market-summary"

afterEach(() => vi.unstubAllGlobals())

function requests(input: RequestInfo | URL) {
  return new URL(String(input), "http://test").searchParams
    .getAll("q")
    .map((q) => new URLSearchParams(decodeBatchItem(q) ?? ""))
}

function response(params: URLSearchParams) {
  return {
    data: {
      available: true,
      shops: 2,
      opened_last_year: 1,
      filters: {
        sido: params.get("sido"),
        gugun: "",
        category: params.get("category"),
      },
    },
  }
}

describe("national market loading", () => {
  it("only asks for province aggregates in batches of at most eight", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      Response.json({ results: requests(input).map(response) })
    )
    vi.stubGlobal("fetch", fetchMock)
    const provinces = Array.from({ length: 9 }, (_, i) => `예시 지역 ${i}`)
    expect(await loadNationalMarket(provinces, "네일")).toEqual({
      available: true,
      shops: 18,
      opened_last_year: 9,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const chunks = fetchMock.mock.calls.map(([input]) => requests(input))
    expect(chunks.map((chunk) => chunk.length)).toEqual([8, 1])
    expect(chunks.flat().map((params) => params.get("sido"))).toEqual(provinces)
    expect(
      chunks
        .flat()
        .every(
          (params) =>
            params.get("resource") === "market" && !params.has("gugun")
        )
    ).toBe(true)
  })

  it("fails the entire total when one region is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json({
          results: requests(input).map((params, index) =>
            index === 0
              ? { data: { available: false, reason: "SELECT_REGION" } }
              : response(params)
          ),
        })
      )
    )
    await expect(
      loadNationalMarket(["예시 A", "예시 B"], "네일")
    ).rejects.toThrow("INCOMPLETE_REGIONS")
  })

  it("preserves source retry instructions and finishes queued batches before retrying", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      Response.json({
        results: requests(input).map((params) =>
          params.get("sido") === "예시 8"
            ? { error: "BUSY", retryAfter: 60 }
            : params.get("sido") === "예시 0"
              ? { error: "BUSY", retryAfter: 5 }
              : response(params)
        ),
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    const error = await loadNationalMarket(
      Array.from({ length: 9 }, (_, i) => `예시 ${i}`),
      "네일"
    ).catch((error: unknown) => error)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(error).toBeInstanceOf(AreaError)
    expect(error instanceof AreaError && error.retryAfterMs).toBe(60_000)
  })
})
