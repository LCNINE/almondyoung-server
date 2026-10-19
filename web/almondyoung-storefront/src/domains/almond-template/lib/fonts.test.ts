import { describe, expect, it } from "vitest"
import { SANS_FONT, fontStack, uploadedFontValue } from "./fonts"

const FAMILY = "AF0199a1b2c3d47e5f80718293a4b5c6d7"

describe("fontStack", () => {
  it("올린 글꼴은 그대로 두어 화면·인쇄가 같은 이름을 쓴다", () => {
    expect(fontStack(uploadedFontValue(FAMILY))).toBe(
      `'${FAMILY}', ${SANS_FONT}`
    )
  })

  it("형식이 다른 이름은 기본 고딕으로 바꾼다", () => {
    expect(fontStack(`'${FAMILY}x', ${SANS_FONT}`)).toBe(SANS_FONT)
    expect(fontStack(`'${FAMILY}'; } body { color: red`)).toBe(SANS_FONT)
  })
})
