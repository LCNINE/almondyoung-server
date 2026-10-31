import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const jar = new Map<string, string>()
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    toString: () =>
      Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; "),
  }),
  headers: async () => new Headers(),
}))

vi.mock("@/lib/config/backend", () => ({
  getBackendBaseUrl: () => "http://medusa.test",
  backendTenantHeaders: () => ({}),
}))

import { ApiAuthError } from "@lib/api/api-error"
import {
  getPurchaseSatisfaction,
  savePurchaseSatisfaction,
} from "./purchase-satisfaction"

const fetchMock = vi.fn()
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

beforeEach(() => {
  jar.clear()
  jar.set("_medusa_jwt", "medusa-token")
  jar.set("accessToken", "user-service-token")
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

const call = () => fetchMock.mock.calls[0] as [string, RequestInit]

describe("구매 만족도 Medusa 호출", () => {
  it("_medusa_jwt 를 bearer 로 보내고 user-service 토큰은 보내지 않는다", async () => {
    fetchMock.mockResolvedValue(
      ok({ satisfaction: { rating: 5, reasons: [], memo: null } })
    )
    await getPurchaseSatisfaction("order_1")
    const h = call()[1].headers as Record<string, string>
    expect(h.authorization).toBe("Bearer medusa-token")
    expect(JSON.stringify(h)).not.toContain("user-service-token")
    expect(call()[0]).toContain("/store/orders/order_1/purchase-satisfaction")
  })

  it("GET 200 이면 satisfaction 을 돌려주고 404 면 null", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ satisfaction: { rating: 2, reasons: ["OTHER"], memo: "m" } })
    )
    expect(await getPurchaseSatisfaction("order_1")).toEqual({
      rating: 2,
      reasons: ["OTHER"],
      memo: "m",
    })
    fetchMock.mockResolvedValueOnce(ok({ message: "nf" }, 404))
    expect(await getPurchaseSatisfaction("order_1")).toBeNull()
  })

  it("GET 이 404 가 아닌 실패면 null 로 삼키지 않고 던진다", async () => {
    fetchMock.mockResolvedValue(ok({ message: "bad" }, 502))
    await expect(getPurchaseSatisfaction("order_1")).rejects.toBeTruthy()
  })

  it("PUT body 에 넘긴 필드만 담고 응답을 돌려준다", async () => {
    fetchMock.mockResolvedValue(
      ok({ satisfaction: { rating: 3, reasons: [], memo: null } })
    )
    const res = await savePurchaseSatisfaction("order_1", { rating: 3 })
    expect(call()[1].method).toBe("PUT")
    expect(JSON.parse(call()[1].body as string)).toEqual({ rating: 3 })
    expect(res.rating).toBe(3)
  })

  it("PUT 실패는 던진다", async () => {
    fetchMock.mockResolvedValue(ok({ message: "bad" }, 502))
    await expect(
      savePurchaseSatisfaction("order_1", { rating: 3 })
    ).rejects.toBeTruthy()
  })

  it("_medusa_jwt 가 없으면 ApiAuthError, 요청 없음", async () => {
    jar.delete("_medusa_jwt")
    await expect(getPurchaseSatisfaction("o")).rejects.toBeInstanceOf(
      ApiAuthError
    )
    await expect(
      savePurchaseSatisfaction("o", { rating: 1 })
    ).rejects.toBeInstanceOf(ApiAuthError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
