import { describe, expect, it } from "vitest"
import { quadMatrix3d, WINDOW_MOCKUP } from "./photo-mockup"

function apply(matrix: string, x: number, y: number): [number, number] {
  const m = matrix.slice("matrix3d(".length, -1).split(",").map(Number)
  const X = m[0] * x + m[4] * y + m[12]
  const Y = m[1] * x + m[5] * y + m[13]
  const W = m[3] * x + m[7] * y + m[15]

  return [X / W, Y / W]
}

describe("quadMatrix3d", () => {
  it("sends the element corners to the banner corners on the glass", () => {
    const matrix = quadMatrix3d(WINDOW_MOCKUP.quad, 1000, 1000)
    const corners: [number, number][] = [
      [0, 0],
      [1000, 0],
      [1000, 1000],
      [0, 1000],
    ]

    corners.forEach(([x, y], i) => {
      const [px, py] = apply(matrix, x, y)
      expect(px).toBeCloseTo(WINDOW_MOCKUP.quad[i][0], 3)
      expect(py).toBeCloseTo(WINDOW_MOCKUP.quad[i][1], 3)
    })
  })

  it("is a plain scale for an axis-aligned rectangle", () => {
    expect(
      quadMatrix3d(
        [
          [0, 0],
          [200, 0],
          [200, 100],
          [0, 100],
        ],
        100,
        100
      )
    ).toBe("matrix3d(2,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)")
  })
})
