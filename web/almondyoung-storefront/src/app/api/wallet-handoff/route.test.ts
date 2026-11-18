import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiAuthError } from "@/lib/api/api-error"

const issueWalletHandoffCode = vi.fn()
const cookieValues = new Map<string, string>()

vi.mock("@/lib/api/users/auth/payment-handoff", () => ({
  issueWalletHandoffCode: (input: unknown) => issueWalletHandoffCode(input),
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValues.has(name) ? { value: cookieValues.get(name) } : undefined,
  }),
}))

import { GET } from "./route"

const CALLBACK = "https://wallet.example/auth/callback"

function request(query: Record<string, string>) {
  const url = new URL("https://shop.example/api/wallet-handoff")
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }

  return new NextRequest(url)
}

const valid = {
  redirect_uri: CALLBACK,
  state: "st",
  code_challenge: "ch",
  code_challenge_method: "S256",
  nonce: "nn",
}

describe("GET /api/wallet-handoff", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_WEB_URL", "https://wallet.example")
    issueWalletHandoffCode.mockReset()
    cookieValues.clear()
  })

  it("지금 고객 몫의 코드를 받아 wallet-web 콜백으로 state 와 함께 돌려보낸다", async () => {
    issueWalletHandoffCode.mockResolvedValue("code-1")

    const res = await GET(request(valid))

    const location = new URL(res.headers.get("location")!)
    expect(location.origin + location.pathname).toBe(CALLBACK)
    expect(location.searchParams.get("code")).toBe("code-1")
    expect(location.searchParams.get("state")).toBe("st")
    expect(issueWalletHandoffCode).toHaveBeenCalledWith({
      redirectUri: CALLBACK,
      codeChallenge: "ch",
      nonce: "nn",
      scope: undefined,
    })
  })

  it("wallet-web 콜백이 아닌 곳으로는 보내지 않는다", async () => {
    const res = await GET(request({ ...valid, redirect_uri: "https://evil.example/cb" }))

    expect(res.status).toBe(400)
    expect(issueWalletHandoffCode).not.toHaveBeenCalled()
  })

  it("access token 이 만료됐으면 한 번만 복구하고, 그래도 안 되면 login_required 로 돌려보낸다", async () => {
    issueWalletHandoffCode.mockRejectedValue(new ApiAuthError())
    cookieValues.set("refreshToken", "rt")

    const first = await GET(request(valid))
    const restore = new URL(first.headers.get("location")!)
    expect(restore.pathname).toBe("/api/auth/restore-token")
    expect(restore.searchParams.get("return_to")).toContain("restored=1")

    const second = await GET(request({ ...valid, restored: "1" }))
    const back = new URL(second.headers.get("location")!)
    expect(back.origin + back.pathname).toBe(CALLBACK)
    expect(back.searchParams.get("error")).toBe("login_required")
  })
})
