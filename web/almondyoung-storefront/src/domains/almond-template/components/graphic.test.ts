import { describe, expect, it } from "vitest"
import type { Layer } from "../lib/document"
import { fittedFontSize, textBoxFor } from "./graphic"

const layer: Layer = {
  id: "t",
  name: "텍스트",
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 30,
  fill: "#000000",
  text: "테스트배너",
  fontSize: 20,
}

describe("textBoxFor", () => {
  it("키운 글자 크기가 그대로 렌더되도록 상자를 맞춘다", () => {
    const resized = { ...layer, ...textBoxFor(layer, 56.5) }
    expect(fittedFontSize(resized)).toBeCloseTo(56.5)
  })

  it("줄이면 높이는 줄고 너비는 유지한다", () => {
    expect(textBoxFor(layer, 10)).toEqual({
      fontSize: 10,
      width: 100,
      height: 12,
    })
  })
})
