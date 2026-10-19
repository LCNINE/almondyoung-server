import { describe, expect, it } from "vitest"
import { removeEdgeBackground } from "./background-removal"

type Rgb = [number, number, number]

function image(rows: string[], colors: Record<string, Rgb>) {
  return new Uint8ClampedArray(
    rows.flatMap((row) => row.split("").flatMap((c) => [...colors[c], 255]))
  )
}
const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4))

const YELLOW: Rgb = [242, 219, 104]
const BLUE: Rgb = [46, 134, 193]

describe("가장자리 바탕 지우기", () => {
  it("흰색이 아닌 바탕을 지우고, 글자 O 속 같은 구멍도 지운다", () => {
    const data = image(["YYYYY", "YBBBY", "YBYBY", "YBBBY", "YYYYY"], {
      Y: YELLOW,
      B: BLUE,
    })
    expect(removeEdgeBackground(data, 5, 5)).toBe(17)
    expect(pixel(data, 5, 0, 0)[3]).toBe(0)
    expect(pixel(data, 5, 2, 2)[3]).toBe(0)
    expect(pixel(data, 5, 1, 1)[3]).toBe(255)
  })

  it("막힌 안쪽이 바탕색과 눈에 띄게 다르면 그림으로 보고 남긴다", () => {
    const data = image(["YYYYY", "YBBBY", "YBOBY", "YBBBY", "YYYYY"], {
      Y: YELLOW,
      B: BLUE,
      O: [230, 160, 40],
    })
    removeEdgeBackground(data, 5, 5)
    expect(pixel(data, 5, 2, 2)[3]).toBe(255)
  })

  it("경계의 섞인 색은 바탕색 성분을 빼서 테두리선이 남지 않는다", () => {
    // 남색 바탕 위 흰 글자, 사이에 반쯤 섞인 경계 픽셀
    const data = image(["NNNNNNN", "NMWWWMN", "NNNNNNN"], {
      N: [31, 39, 77],
      M: [143, 147, 166],
      W: [255, 255, 255],
    })
    removeEdgeBackground(data, 7, 3)
    const [r, g, b, a] = pixel(data, 7, 1, 1)
    expect(a).toBeGreaterThan(80)
    expect(a).toBeLessThan(220)
    // 남색이 빠져 흰색에 가깝게 돌아온다
    expect(Math.min(r, g, b)).toBeGreaterThan(220)
    expect(pixel(data, 7, 3, 1)).toEqual([255, 255, 255, 255])
  })

  it("JPG 얼룩처럼 가장자리 색이 조금씩 흔들려도 바탕을 다 지운다", () => {
    const rows = Array.from({ length: 9 }, (_, y) =>
      Array.from({ length: 9 }, (_, x) =>
        x >= 3 && x <= 5 && y >= 3 && y <= 5 ? "B" : "abcd"[(x * 7 + y * 3) % 4]
      ).join("")
    )
    const data = image(rows, {
      a: [242, 219, 104],
      b: [234, 212, 112],
      c: [249, 226, 96],
      d: [238, 223, 100],
      B: BLUE,
    })
    removeEdgeBackground(data, 9, 9)
    const left = rows
      .flatMap((row, y) => row.split("").map((c, x) => [c, x, y] as const))
      .filter(([c, x, y]) => c !== "B" && pixel(data, 9, x, y)[3] !== 0)
    expect(left).toEqual([])
    expect(pixel(data, 9, 4, 4)[3]).toBe(255)
  })

  it("가장자리가 이미 투명하면 아무것도 바꾸지 않는다", () => {
    const data = new Uint8ClampedArray(5 * 5 * 4)
    expect(removeEdgeBackground(data, 5, 5)).toBe(0)
  })
})
