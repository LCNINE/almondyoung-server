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
}))

import { ApiAuthError } from "@lib/api/api-error"
import {
  cancelReturn,
  getOrderReturns,
  getReturnable,
  requestReturn,
} from "./returns"

const fetchMock = vi.fn()

beforeEach(() => {
  jar.clear()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ returns: [], lines: [] }), { status: 200 })
  )
  vi.stubGlobal("fetch", fetchMock)
})

const sentHeaders = () =>
  (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>

describe("Medusa 반품 라우트 인증", () => {
  it("_medusa_jwt 를 bearer 로 보내고 user-service 토큰·쿠키는 보내지 않는다", async () => {
    jar.set("_medusa_jwt", "medusa-token")
    jar.set("accessToken", "user-service-token")
    await getOrderReturns("order_1")
    const h = sentHeaders()
    expect(h.authorization).toBe("Bearer medusa-token")
    expect(h.Authorization).toBeUndefined()
    expect(JSON.stringify(h)).not.toContain("user-service-token")
    expect(h.Cookie).toBeUndefined()
  })

  it("_medusa_jwt 가 없으면 getOrderReturns 는 요청 없이 null", async () => {
    jar.set("accessToken", "user-service-token")
    expect(await getOrderReturns("order_1")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("_medusa_jwt 가 없으면 나머지 셋은 ApiAuthError, 요청 없음", async () => {
    await expect(getReturnable("o")).rejects.toBeInstanceOf(ApiAuthError)
    await expect(
      requestReturn("o", { requestId: "r", items: [], reason: "x" } as never)
    ).rejects.toBeInstanceOf(ApiAuthError)
    await expect(cancelReturn("o", "ret")).rejects.toBeInstanceOf(ApiAuthError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
