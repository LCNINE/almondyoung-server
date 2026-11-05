import { renderToStaticMarkup } from "react-dom/server"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import type { Layer } from "../lib/document"
import { LayerGraphic } from "./graphic"

const layer: Layer = {
  id: "texture",
  name: "질감",
  type: "rect",
  x: 5,
  y: 5,
  width: 20,
  height: 20,
  fill: "#808080",
  texture: true,
}

const render = (patch: Partial<Layer> = {}) =>
  renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="360"
      height="360"
      viewBox="0 0 30 30"
    >
      <LayerGraphic layer={{ ...layer, ...patch }} />
    </svg>
  )

const raster = (patch: Partial<Layer>) =>
  sharp(Buffer.from(render(patch)))
    .ensureAlpha()
    .raw()
    .toBuffer()

const alpha = (pixels: Buffer) => pixels.filter((_, i) => i % 4 === 3)

function statistics(pixels: Buffer, channel: number) {
  const values: number[] = []

  for (let y = 72; y < 288; y++) {
    for (let x = 72; x < 288; x++) {
      values.push(pixels[(y * 360 + x) * 4 + channel])
    }
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length

  return { mean, deviation: Math.sqrt(variance) }
}

describe("질감 SVG", () => {
  it("옛 질감은 그레인 40이며 종이는 얼룩과 섬유 주파수를 섞는다", () => {
    const grain = render()
    const paper = render({ textureKind: "paper" })

    expect(grain).toBe(render({ textureKind: "grain", textureAmount: 40 }))
    expect(grain.match(/<feTurbulence /g)).toHaveLength(1)
    expect(paper.match(/<feTurbulence /g)).toHaveLength(2)
    expect(grain).toContain('baseFrequency="3"')
    expect(paper).toContain('baseFrequency="6 2"')
    expect(paper).toContain('baseFrequency="0.2"')
    expect(paper).toContain('k2="0.7" k3="0.3"')
    expect(render({ width: 40, height: 40 })).toContain('baseFrequency="1.5"')
    expect(paper).toContain('in2="SourceAlpha" operator="in"')
    expect(paper).not.toMatch(/feDiffuseLighting|speckle|<image|<feImage/)
  })

  it.each(["grain", "paper"] as const)(
    "%s 강도 0은 원본 픽셀과 같고 질감 토글을 끄면 설정이 적용되지 않는다",
    async (textureKind) => {
      const original = await raster({ texture: false })

      expect(await raster({ textureKind, textureAmount: 0 })).toEqual(original)
      expect(
        await raster({ texture: false, textureKind, textureAmount: 100 })
      ).toEqual(original)
    }
  )

  it.each(["grain", "paper"] as const)(
    "%s는 흰색·회색·유색에서 강도에 따라 편차가 증가하고 평균색은 유지한다",
    async (textureKind) => {
      for (const fill of ["#ffffff", "#808080", "#4488cc"]) {
        const baseline = await raster({ fill, texture: false })
        const previous = [0, 0, 0]

        for (const textureAmount of [20, 40, 70, 100]) {
          const pixels = await raster({ fill, textureKind, textureAmount })

          for (const channel of [0, 1, 2]) {
            const { mean, deviation } = statistics(pixels, channel)
            const original = statistics(baseline, channel)

            expect(deviation).toBeGreaterThan(previous[channel])
            expect(Math.abs(mean - original.mean)).toBeLessThan(3)

            if (textureAmount === 40) {
              expect(deviation).toBeGreaterThan(0.2)
              expect(deviation).toBeLessThan(2.5)
            }

            previous[channel] = deviation
          }

          expect(Buffer.compare(alpha(pixels), alpha(baseline))).toBe(0)
        }
      }
    }
  )

  it.each(["grain", "paper"] as const)(
    "%s는 반투명 도형의 알파와 윤곽 밖 투명 영역을 보존한다",
    async (textureKind) => {
      const patch = { type: "ellipse" as const, opacity: 0.5 }
      const baseline = await raster({ ...patch, texture: false })
      const pixels = await raster({ ...patch, textureKind })

      expect(Buffer.compare(alpha(pixels), alpha(baseline))).toBe(0)
    }
  )

  it("질감은 그림자 아래가 아니라 원본 자리에 놓고 입체 하이라이트를 유지한다", () => {
    const svg = render({ shadow: true, bevel: true })

    expect(svg).toContain(
      '<feMerge><feMergeNode in="shadow"></feMergeNode><feMergeNode in="textured"></feMergeNode><feMergeNode in="bevelSh"></feMergeNode><feMergeNode in="bevelHi"></feMergeNode></feMerge>'
    )
  })
})
