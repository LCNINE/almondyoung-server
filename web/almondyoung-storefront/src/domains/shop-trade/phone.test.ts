import { describe, expect, it } from "vitest"
import { formatPhone, isValidPhone, stripPhone } from "./phone"

describe("stripPhone", () => {
  it("하이픈·공백을 지운다 (서버 stripPhoneSeparators 와 같은 규칙)", () => {
    expect(stripPhone(" 010-1234 5678 ")).toBe("01012345678")
  })
})

describe("isValidPhone", () => {
  it.each([
    ["01012345678", true],
    ["0212345678", true],
    ["021234567", true],
    ["1012345678", false],
    ["010123456789", false],
    ["0101234567a", false],
    ["", false],
  ])("%s → %s", (digits, expected) => {
    expect(isValidPhone(digits)).toBe(expected)
  })
})

describe("formatPhone", () => {
  it.each([
    ["01012345678", "010-1234-5678"],
    ["0311234567", "031-123-4567"],
    ["0212345678", "02-1234-5678"],
    ["021234567", "02-123-4567"],
    ["15881234", "15881234"],
  ])("%s → %s", (digits, expected) => {
    expect(formatPhone(digits)).toBe(expected)
  })
})
