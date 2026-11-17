import { afterEach, describe, expect, it, vi } from "vitest"
import { goToWalletWeb } from "./wallet-web-navigation"

describe("goToWalletWeb", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("남은 wallet-web 세션 대신 항상 /auth/handoff 로 지금 고객의 보증을 받으러 간다", () => {
    const location = { href: "" }
    vi.stubEnv("NEXT_PUBLIC_WALLET_WEB_URL", "https://wallet.example")
    vi.stubGlobal("window", { location })

    goToWalletWeb("/billing-change?returnUrl=https%3A%2F%2Fshop.example%2Fkr")

    const url = new URL(location.href)
    expect(url.origin + url.pathname).toBe("https://wallet.example/auth/handoff")
    expect(url.searchParams.get("redirect_to")).toBe(
      "/billing-change?returnUrl=https%3A%2F%2Fshop.example%2Fkr"
    )
  })
})
