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

const paper = { widthMm: 210, heightMm: 297 }

describe("textBoxFor", () => {
  it("키운 글자 크기가 그대로 렌더되도록 상자를 맞춘다", () => {
    const resized = { ...layer, ...textBoxFor(layer, 56.5, paper) }
    expect(fittedFontSize(resized)).toBeCloseTo(56.5)
  })

  it("줄이면 높이는 줄고 너비는 유지한다", () => {
    expect(textBoxFor(layer, 10, paper)).toEqual({
      fontSize: 10,
      width: 100,
      height: 12,
    })
  })

  it("키워도 상자가 저장 가능한 범위(용지의 2배)를 넘지 않는다", () => {
    const dashes = { ...layer, text: "-".repeat(67), width: 40, height: 6 }
    const grown = textBoxFor(dashes, 30.85, paper)
    expect(grown.width).toBe(420)
    expect(textBoxFor({ ...dashes, ...grown }, 5, paper).width).toBe(420)
  })
})
