import { describe, expect, it } from "vitest"
import { observationPlot } from "./observation-plot"

describe("observation plot", () => {
  it("uses actual date spacing and keeps observed zero", () => {
    const points = observationPlot([
      { at: "2026-01-11", value: 10 },
      { at: "2026-01-01", value: 0 },
      { at: "2026-01-02", value: 1 },
    ])
    expect(points.map((point) => point.x)).toEqual([16, 44.8, 304])
    expect(points[0].value).toBe(0)
    expect(points[0].y).toBe(144)
    expect(points[2].y).toBe(16)
  })

  it("places constant values centrally and filters invalid observations", () => {
    expect(observationPlot([{ at: "invalid", value: 0 }])).toEqual([])
    expect(observationPlot([{ at: "2026-01-01", value: 0 }])).toEqual([
      { at: "2026-01-01", value: 0, x: 160, y: 80 },
    ])
    expect(
      observationPlot([
        { at: "2026-01-01", value: Infinity },
        { at: "2026-01-02", value: -1 },
      ])
    ).toEqual([])
  })
})
