import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api/medusa/sso", () => ({
  oidcCallback: vi.fn().mockResolvedValue({
    success: true,
    redirectTo: "/kr",
    accessToken: "A",
    createdCustomer: false,
  }),
}))
vi.mock("@/lib/sms-ref/sms-ref", () => ({ settleSmsRef: vi.fn() }))

import { oidcCallback } from "@/lib/api/medusa/sso"
import { settleSmsRef } from "@/lib/sms-ref/sms-ref"
import { GET } from "./route"

it("keeps the browser host when Next.js normalizes the callback URL to localhost", async () => {
  const request = new NextRequest(
    "http://localhost:8000/kr/callback/oidc?code=test-code&state=test-state",
    { headers: { host: "172.30.1.13:8000" } },
  )
  const response = await GET(request, {
    params: Promise.resolve({ countryCode: "kr" }),
  })
  const html = await response.text()

  expect(html).toContain('location.replace("/kr")')
  expect(html).not.toContain("localhost")
})

it("escapes script terminators in the redirect path", async () => {
  vi.mocked(oidcCallback).mockResolvedValueOnce({
    success: true,
    redirectTo: "/kr/</script><script>alert(1)</script>",
    accessToken: "A",
    createdCustomer: false,
  })
  const request = new NextRequest("http://localhost:8000/kr/callback/oidc?code=c&state=s")
  const response = await GET(request, { params: Promise.resolve({ countryCode: "kr" }) })
  const html = await response.text()

  expect(html.match(/<\/script>/g)).toHaveLength(1)
  expect(html).toContain('location.replace("/kr/\\u003c/script>')
})

it("shows a fixed message instead of the server error", async () => {
  vi.mocked(oidcCallback).mockResolvedValueOnce({
    success: false,
    error: 'customer create failed: 401 {"message":"Login identity has no user id"}',
  })
  const request = new NextRequest("http://localhost:8000/kr/callback/oidc?code=c&state=s")
  const response = await GET(request, { params: Promise.resolve({ countryCode: "kr" }) })
  const html = await response.text()

  expect(html).toContain("로그인하지 못했어요")
  expect(html).toContain('href="/kr/account/login"')
  expect(html).not.toContain("customer create failed")
})

it("shows the failure screen in the country's language", async () => {
  vi.mocked(oidcCallback).mockResolvedValueOnce({ success: false, error: "x" })
  const request = new NextRequest("http://localhost:8000/jp/callback/oidc?code=c&state=s")
  const response = await GET(request, { params: Promise.resolve({ countryCode: "jp" }) })
  const html = await response.text()

  expect(html).toContain("ログインできませんでした")
  expect(html).toContain('href="/jp/account/login"')
})

describe("추적 링크 연결", () => {
  const callback = (cookie: string) =>
    GET(new NextRequest("http://localhost:8000/kr/callback/oidc?code=c&state=s", { headers: { cookie } }), {
      params: Promise.resolve({ countryCode: "kr" }),
    })

  beforeEach(() => vi.mocked(settleSmsRef).mockReset())

  it("기존 고객이면 login 으로, 받은 토큰으로 기록한다", async () => {
    const response = await callback("sms_ref=AbCd_123")

    expect(settleSmsRef).toHaveBeenCalledTimes(1)
    const [, res, token, kind] = vi.mocked(settleSmsRef).mock.calls[0]
    expect(res).toBe(response)
    expect(token).toBe("A")
    expect(kind).toBe("login")
    expect(await response.text()).toContain('location.replace("/kr")')
  })

  it("쇼핑몰 고객을 새로 만들었으면 signup", async () => {
    vi.mocked(oidcCallback).mockResolvedValueOnce({
      success: true,
      redirectTo: "/kr",
      accessToken: "A",
      createdCustomer: true,
    })
    await callback("sms_ref=AbCd_123")

    expect(vi.mocked(settleSmsRef).mock.calls[0][3]).toBe("signup")
  })

  it("로그인에 실패하면 부르지 않는다", async () => {
    vi.mocked(oidcCallback).mockResolvedValueOnce({ success: false, error: "x" })
    await callback("sms_ref=AbCd_123")

    expect(settleSmsRef).not.toHaveBeenCalled()
  })
})
