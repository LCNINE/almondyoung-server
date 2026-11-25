import { NextRequest } from "next/server"
import { expect, it, vi } from "vitest"

vi.mock("@/lib/api/medusa/sso", () => ({
  oidcCallback: vi.fn().mockResolvedValue({ success: true, redirectTo: "/kr" }),
}))

import { oidcCallback } from "@/lib/api/medusa/sso"
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
