import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api/api", () => ({ api: vi.fn() }))
vi.mock("@/lib/config/backend", () => ({ requireBackendBaseUrl: () => "http://notification.test" }))
vi.mock("@/lib/sms-ref/sms-ref", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms-ref/sms-ref")>()),
  recordSmsRef: vi.fn(),
}))

import { recordSmsRef } from "@/lib/sms-ref/sms-ref"
import { GET } from "./route"

const recordMock = vi.mocked(recordSmsRef)
const fetchMock = vi.fn()
const jwt = (expOffsetSeconds: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expOffsetSeconds })).toString("base64url")}.s`

// 미들웨어가 /r/<코드> 를 rewrite 해도 라우트가 받는 request.url 은 원래 주소다(로컬 next dev 실측) —
// 그래서 코드는 쿼리가 아니라 rewrite 된 경로의 파라미터로만 받는다.
const click = (cookie?: string) =>
  GET(new NextRequest("http://localhost:8000/r/AbCd_123", cookie ? { headers: { cookie } } : undefined), {
    params: Promise.resolve({ code: "AbCd_123" }),
  })

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  recordMock.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe("GET /api/sms-link", () => {
  const clicked = () =>
    fetchMock.mockResolvedValueOnce(Response.json({ url: "https://shop.example/kr/p/1" }))

  it("로그인 전이면 원래 URL 로 보내며 sms_ref 쿠키를 7일 심는다", async () => {
    clicked()
    const response = await click()

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("https://shop.example/kr/p/1")
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("sms_ref=AbCd_123")
    expect(setCookie).toContain("Max-Age=604800")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie.toLowerCase()).toContain("samesite=lax")
    expect(recordMock).not.toHaveBeenCalled()
  })

  it("살아 있는 액세스 토큰이 있으면 그 자리에서 기록하고 쿠키를 심지 않는다", async () => {
    clicked()
    recordMock.mockResolvedValueOnce(true)
    const token = jwt(3600)
    const response = await click(`accessToken=${token}`)

    expect(recordMock).toHaveBeenCalledWith("AbCd_123", token, "clicked_signed_in")
    expect(response.headers.get("location")).toBe("https://shop.example/kr/p/1")
    expect(response.headers.get("set-cookie") ?? "").not.toContain("sms_ref=")
  })

  it("그 자리 기록이 실패하면 쿠키를 심어 나중에 다시 잡는다", async () => {
    clicked()
    recordMock.mockResolvedValueOnce(false)
    const response = await click(`accessToken=${jwt(3600)}`)

    expect(response.headers.get("set-cookie") ?? "").toContain("sms_ref=AbCd_123")
  })

  it("액세스 토큰이 만료되고 refreshToken 만 있으면 기록하지 않고 쿠키를 심는다", async () => {
    clicked()
    const response = await click(`accessToken=${jwt(-60)}; refreshToken=r1`)

    expect(recordMock).not.toHaveBeenCalled()
    expect(response.headers.get("set-cookie") ?? "").toContain("sms_ref=AbCd_123")
  })

  it.each([
    ["404", () => fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }))],
    ["네트워크 오류", () => fetchMock.mockRejectedValueOnce(new Error("down"))],
  ])("click 이 %s 이면 홈으로 보내고 쿠키를 심지 않는다", async (_, fail) => {
    fail()
    const response = await click()

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("http://localhost:8000/kr")
    expect(response.headers.get("set-cookie") ?? "").not.toContain("sms_ref=")
  })
})
