import { describe, expect, it } from "vitest"
import type { Layer } from "../lib/document"
import { bleedExtended } from "./print-svg"

const image = (x: number, width: number): Layer => ({
  id: "i",
  name: "사진",
  type: "image",
  x,
  y: 0,
  width,
  height: 50,
  fill: "#000000",
})

describe("bleedExtended", () => {
  it("가장자리에 닿은 상자만 재단 여백까지 늘린다", () => {
    expect(bleedExtended(image(0, 90), 90, 50, 1)).toMatchObject({
      x: -1,
      y: -1,
      width: 92,
      height: 52,
    })
    expect(bleedExtended(image(10, 20), 90, 50, 1)).toMatchObject({
      x: 10,
      width: 20,
    })
  })

  it("이미 재단 여백 밖까지 나간 상자는 줄이지 않는다", () => {
    expect(bleedExtended(image(-20, 80), 90, 50, 1)).toMatchObject({
      x: -20,
      width: 80,
    })
    expect(bleedExtended(image(-30, 10), 90, 50, 1)).toMatchObject({
      x: -30,
      width: 10,
    })
    expect(bleedExtended(image(80, 30), 90, 50, 1)).toMatchObject({
      x: 80,
      width: 30,
    })
  })
})
