import { describe, expect, it } from "vitest"
import { decideStartupAction } from "./decide"

const NOW = 10_000

describe("decideStartupAction", () => {
  it("토큰이 없으면 로그인한다", () => {
    expect(decideStartupAction({ tokens: null, now: NOW })).toBe("login")
  })

  it("refreshToken 이 살아있으면 건너뛴다", () => {
    expect(
      decideStartupAction({
        tokens: { accessToken: "a", refreshToken: "r", expiresAt: NOW + 600_000 },
        now: NOW,
      }),
    ).toBe("skip")
  })

  it("accessToken 이 만료돼도 refreshToken 이 있으면 건너뛴다", () => {
    expect(
      decideStartupAction({
        tokens: { accessToken: "a", refreshToken: "r", expiresAt: NOW - 1 },
        now: NOW,
      }),
    ).toBe("skip")
  })

  it("refreshToken 이 비어 있으면 로그인한다", () => {
    expect(
      decideStartupAction({
        tokens: { accessToken: "a", refreshToken: "", expiresAt: NOW + 600_000 },
        now: NOW,
      }),
    ).toBe("login")
  })
})
