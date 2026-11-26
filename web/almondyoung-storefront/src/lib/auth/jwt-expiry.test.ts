import { describe, expect, it } from "vitest"
import { isJwtExpired } from "./jwt-expiry"

const jwtWithExp = (exp: number) =>
  `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`

describe("isJwtExpired", () => {
  it("토큰이 없으면 만료로 본다", () => {
    expect(isJwtExpired(undefined)).toBe(true)
  })

  it("exp 가 지났으면 만료", () => {
    expect(isJwtExpired(jwtWithExp(Math.floor(Date.now() / 1000) - 10))).toBe(true)
  })

  it("exp 가 한 시간 뒤면 살아 있다", () => {
    expect(isJwtExpired(jwtWithExp(Math.floor(Date.now() / 1000) + 3600))).toBe(false)
  })

  it("깨진 문자열은 만료로 본다", () => {
    expect(isJwtExpired("not-a-jwt")).toBe(true)
  })
})
