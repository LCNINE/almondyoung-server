import { describe, expect, it } from "vitest"
import { placeholderThumbnail } from "./design-images"

describe("placeholderThumbnail", () => {
  it("규격 비율대로 바탕색을 칠한 SVG 를 만든다", () => {
    const svg = placeholderThumbnail(150, 300, "#ffcc00")

    expect(svg).toMatch(/^<svg[\s>]/)
    expect(svg).toContain('width="400" height="800"')
    expect(svg).toContain('fill="#ffcc00"')
  })

  it("색이 아닌 값은 흰 바탕으로 바꿔 넣는다", () => {
    expect(placeholderThumbnail(90, 50, '"/><script>')).toContain(
      'fill="#ffffff"'
    )
  })
})
