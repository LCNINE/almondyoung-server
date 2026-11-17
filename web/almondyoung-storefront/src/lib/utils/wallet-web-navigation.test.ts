import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mintPaymentHandoffToken = vi.fn()

vi.mock("@/lib/api/users/auth/payment-handoff", () => ({
  mintPaymentHandoffToken: () => mintPaymentHandoffToken(),
}))

import { goToWalletWeb } from "./wallet-web-navigation"

const WALLET = "https://wallet.example"
const PATH = "/billing-change?returnUrl=https%3A%2F%2Fshop.example%2Fkr"

function unauthorized(): Error {
  return Object.assign(new Error("UNAUTHORIZED"), { digest: "UNAUTHORIZED" })
}

describe("goToWalletWeb", () => {
  const location = { href: "" }
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_WEB_URL", WALLET)
    vi.stubGlobal("window", { location })
    vi.stubGlobal("fetch", fetchMock)
    location.href = ""
    mintPaymentHandoffToken.mockReset()
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("핸드오프 토큰으로 wallet-web 세션을 지금 고객으로 덮어쓴다", async () => {
    mintPaymentHandoffToken.mockResolvedValue("h-token")

    await goToWalletWeb(PATH)

    const url = new URL(location.href)
    expect(url.origin + url.pathname).toBe(`${WALLET}/auth/handoff`)
    expect(url.searchParams.get("h")).toBe("h-token")
    expect(url.searchParams.get("redirect_to")).toBe(PATH)
  })

  it("401 이면 토큰을 복구한 뒤 다시 발급한다", async () => {
    mintPaymentHandoffToken
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValueOnce("retry-token")
    fetchMock.mockResolvedValue({ ok: true })

    await goToWalletWeb(PATH)

    expect(new URL(location.href).searchParams.get("h")).toBe("retry-token")
  })

  it.each([
    ["발급 실패", () => mintPaymentHandoffToken.mockRejectedValue(new Error("down"))],
    [
      "복구 실패",
      () => {
        mintPaymentHandoffToken.mockRejectedValue(unauthorized())
        fetchMock.mockResolvedValue({ ok: false })
      },
    ],
  ])("%s 면 남은 wallet-web 세션을 쓰지 않고 /login 으로 보낸다", async (_, arrange) => {
    arrange()

    await goToWalletWeb(PATH)

    const url = new URL(location.href)
    expect(url.origin + url.pathname).toBe(`${WALLET}/login`)
    expect(url.searchParams.get("redirect_to")).toBe(PATH)
  })
})
