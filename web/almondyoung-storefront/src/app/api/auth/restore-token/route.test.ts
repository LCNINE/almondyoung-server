import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cookieJar = vi.hoisted(() => ({ values: new Map<string, string>() }))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.values.has(name) ? { value: cookieJar.values.get(name) } : undefined) }),
}))
vi.mock("@/lib/auth/user-service", () => ({ restoreAccessToken: vi.fn() }))
vi.mock("@/lib/config/backend", () => ({ requireBackendBaseUrl: () => "http://medusa.test" }))
vi.mock("@/lib/api/api", () => ({ api: vi.fn() }))
vi.mock("@/lib/sms-ref/sms-ref", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms-ref/sms-ref")>()),
  settleSmsRef: vi.fn(),
}))

import { settleSmsRef } from "@/lib/sms-ref/sms-ref"
import { GET, POST } from "./route"

const settleMock = vi.mocked(settleSmsRef)
const fetchMock = vi.fn()

function requestWith(method: "GET" | "POST", cookies: Record<string, string>) {
  cookieJar.values = new Map(Object.entries(cookies))
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ")
  return new NextRequest("http://localhost:8000/api/auth/restore-token?return_to=/kr/p/1", {
    method,
    headers: { cookie },
  })
}

beforeEach(() => {
  vi.stubEnv("OIDC_ISSUER_URL", "https://id.example")
  vi.stubEnv("OIDC_CLIENT_SECRET", "x")
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  settleMock.mockReset()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const rotated = () =>
  fetchMock.mockResolvedValueOnce(
    Response.json({ access_token: "NEW", refresh_token: "R2", token_type: "Bearer", expires_in: 900 })
  )

describe("restore-token 이 추적 링크 연결을 잡는다", () => {
  it("records with the freshly issued token", async () => {
    rotated()
    const request = requestWith("GET", { refreshToken: "R1", sms_ref: "AbCd_123" })
    const response = await GET(request)

    expect(settleMock).toHaveBeenCalledTimes(1)
    expect(settleMock.mock.calls[0][0]).toBe(request)
    expect(settleMock.mock.calls[0][2]).toBe("NEW")
    expect(settleMock.mock.calls[0][3]).toBe("clicked_signed_in")
    expect(response.headers.get("location")).toBe("http://localhost:8000/kr/p/1")
  })

  it("클라이언트가 부르는 POST 도 같다", async () => {
    rotated()
    await POST(requestWith("POST", { refreshToken: "R1", sms_ref: "AbCd_123" }))

    expect(settleMock).toHaveBeenCalledTimes(1)
    expect(settleMock.mock.calls[0][2]).toBe("NEW")
  })

  it("갱신에 실패하면 부르지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 }))
    await GET(requestWith("GET", { refreshToken: "R1", sms_ref: "AbCd_123" }))

    expect(settleMock).not.toHaveBeenCalled()
  })
})
