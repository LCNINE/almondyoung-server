import { describe, expect, it } from "vitest"
import { toneTileSize, validColorFilter } from "./layer-style"
import { newDesign, parseDesign } from "./document"
import { makeLayer } from "./layer"

describe("톤 망점 크기", () => {
  it("기본 40과 레이어 mm 크기에 비례하는 간격을 사용한다", () => {
    expect(toneTileSize(40)).toBe(1)
    expect(toneTileSize(40, 40)).toBe(toneTileSize(40))
    expect(toneTileSize(80, 40)).toBe(2)
    expect(toneTileSize(50, 40)).toBe(1.25)
    expect(toneTileSize(40, 1)).toBeCloseTo(0.22)
    expect(toneTileSize(40, 100)).toBeCloseTo(2.2)
    expect(toneTileSize(0)).toBeGreaterThan(0)
  })

  it.each([undefined, 1, 40, 100])("dotSize %s를 허용한다", (dotSize) => {
    expect(validColorFilter({ kind: "tone", amount: 70, dotSize })).toBe(true)
  })

  it.each([0, -1, 101, NaN, Infinity, "40", null])(
    "잘못된 dotSize %s를 레이어와 양면 배경에서 거부한다",
    (dotSize) => {
      const base = newDesign("card")
      const colorFilter = { kind: "tone", amount: 70, dotSize }

      expect(validColorFilter(colorFilter)).toBe(false)

      for (const side of ["front", "back"] as const) {
        expect(() =>
          parseDesign({
            ...base,
            [side]: [{ ...makeLayer("rect", base), colorFilter }],
          })
        ).toThrow()
      }

      expect(() =>
        parseDesign({ ...base, backgroundFilter: colorFilter })
      ).toThrow()
      expect(() =>
        parseDesign({
          ...base,
          backBackground: {
            background: "#ffffff",
            backgroundFilter: colorFilter,
          },
        })
      ).toThrow()
    }
  )

  it.each([undefined, 1, 40, 100])(
    "dotSize %s를 가진 새 문서와 옛 문서를 그대로 왕복한다",
    (dotSize) => {
      const base = newDesign("card")
      const colorFilter = { kind: "tone" as const, amount: 70, dotSize }
      const layer = { ...makeLayer("rect", base), colorFilter }
      const design = JSON.parse(
        JSON.stringify({
          ...base,
          front: [layer],
          back: [layer],
          backgroundFilter: colorFilter,
          backBackground: {
            background: "#ffffff",
            backgroundFilter: colorFilter,
          },
        })
      )

      expect(parseDesign(design)).toEqual(design)
    }
  )
})
