import { NextRequest } from "next/server"
import { expect, it, vi } from "vitest"

vi.mock("@/lib/api/medusa/sso", () => ({
  oidcCallback: vi.fn().mockResolvedValue({ success: true, redirectTo: "/kr" }),
}))

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
