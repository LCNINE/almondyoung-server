import { describe, expect, it } from "vitest"
import { cmykFromHex, hexFromCmyk } from "./color"

describe("print color picker", () => {
  it("converts black, white, and primary red for CMYK editing", () => {
    expect(cmykFromHex("#000000")).toEqual([0, 0, 0, 100])
    expect(cmykFromHex("#ffffff")).toEqual([0, 0, 0, 0])
    expect(hexFromCmyk([0, 100, 100, 0])).toBe("#ff0000")
  })
})
