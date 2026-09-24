import { expect, test } from "vitest"
import { clearWhiteBackdrop } from "./clear-white-backdrop"

test("removes a white canvas while keeping the logo color", () => {
  const pixels = new Uint8ClampedArray([
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 30, 40, 50, 255,
  ])
  expect(clearWhiteBackdrop(pixels, 2, 2)).toBe(true)
  expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual([0, 0, 0, 255])
})
