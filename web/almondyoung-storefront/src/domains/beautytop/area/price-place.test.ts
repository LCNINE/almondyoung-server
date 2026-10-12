import { describe, expect, it } from "vitest"
import { placeAmong } from "./price-place"

const listed = [35000, 35000, 40000, 40000, 45000, 45000, 50000]

describe("price simulator place", () => {
  it.each([
    [30000, 1, 0, 0],
    [35000, 1, 0, 2],
    [38000, 3, 2, 0],
    [40000, 3, 2, 2],
    [52000, 8, 7, 0],
  ])("%i원 → %i번째 (더 싼 %i · 같은 %i)", (mine, place, cheaper, same) => {
    expect(placeAmong(listed, mine)).toEqual({ place, total: 8, cheaper, same })
  })

  it("works with nothing to compare", () => {
    expect(placeAmong([], 40000)).toEqual({ place: 1, total: 1, cheaper: 0, same: 0 })
  })
})
