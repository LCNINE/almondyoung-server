import { renderToStaticMarkup } from "react-dom/server"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  newDesign,
  parseDesign,
  printsBack,
  type Layer,
  type SideBackground,
} from "../lib/document"
import { Backdrop, LayerGraphic } from "./graphic"

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
  it("옛 질감은 그레인 40이며 그레인은 알갱이+뭉침, 종이는 얼룩·섬유·요철을 섞는다", () => {
    const grain = render()
    const paper = render({ textureKind: "paper" })

    expect(grain).toBe(render({ textureKind: "grain", textureAmount: 40 }))
    expect(grain.match(/<feTurbulence /g)).toHaveLength(2)
    expect(paper.match(/<feTurbulence /g)).toHaveLength(4)
    expect(grain).toContain('baseFrequency="3"')
    expect(grain).toContain('baseFrequency="1.2"')
    expect(paper).toContain('baseFrequency="0.2"')
    expect(paper).toContain('baseFrequency="8.4 1.08"')
    expect(paper).toContain('baseFrequency="1.08 8.4"')
    expect(paper).toContain("<feOffset")
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
      '<feMerge result="fxBase"><feMergeNode in="shadow"></feMergeNode><feMergeNode in="textured"></feMergeNode></feMerge><feComposite in="bevelSh" in2="fxBase" operator="over" result="fxShaded"></feComposite><feComposite in="bevelHi" in2="fxShaded" operator="over"></feComposite>'
    )
  })

  it("입체 그림자는 곱하기, 빛은 발광 닷지로 고른 색을 섞는다", () => {
    const svg = render({
      bevel: true,
      bevelLightColor: "#ffcc00",
      bevelShadowColor: "#3300aa",
      bevelLightMode: "dodge",
      bevelShadowMode: "multiply",
    })

    expect(svg).toContain('flood-color="#ffcc00"')
    expect(svg).toContain('flood-color="#3300aa"')
    expect(svg).toContain('<feBlend in="bevelSh" in2="fxBase" mode="multiply"')
    expect(svg).toContain(
      '<feBlend in="bevelHiSolid" in2="fxShaded" mode="color-dodge"'
    )
  })
})

// 옆 픽셀끼리 밝기 차의 평균. 알갱이가 굵을수록 이웃이 닮아 작아진다
function roughness(pixels: Buffer, width: number) {
  let sum = 0
  let count = 0
  for (let y = 20; y < width - 20; y++)
    for (let x = 20; x < width - 21; x++) {
      const at = (y * width + x) * 4
      sum += Math.abs(pixels[at] - pixels[at + 4])
      count++
    }
  return sum / count
}

describe("질감 입자 크기", () => {
  it("입자 크기를 키우면 결의 주파수가 그만큼 낮아지고 비우면 100% 와 같다", () => {
    expect(render({ textureScale: 200 })).toContain('baseFrequency="1.5"')
    expect(render({ textureScale: 100 })).toBe(render())
  })

  it("입자가 굵을수록 이웃 픽셀이 닮는다", async () => {
    const fine = roughness(
      await raster({ textureAmount: 100, textureScale: 50 }),
      360
    )
    const coarse = roughness(
      await raster({ textureAmount: 100, textureScale: 400 }),
      360
    )
    expect(coarse).toBeLessThan(fine)
  })

  it("범위를 벗어난 입자 크기는 저장하지 않는다", () => {
    const design = newDesign("card")
    const box = { ...layer, x: 1, y: 1 }
    for (const textureScale of [40, 500])
      expect(() =>
        parseDesign({ ...design, front: [{ ...box, textureScale }] })
      ).toThrow()
    expect(() =>
      parseDesign({ ...design, front: [{ ...box, textureScale: 250 }] })
    ).not.toThrow()
  })
})

describe("배경 질감", () => {
  const backdrop = (value: SideBackground) =>
    sharp(
      Buffer.from(
        renderToStaticMarkup(
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="400"
            height="400"
            viewBox="0 0 50 50"
          >
            <Backdrop value={value} width={50} height={50} />
          </svg>
        )
      )
    )
      .ensureAlpha()
      .raw()
      .toBuffer()

  it("배경색·그라데이션 위에 결이 생기고 평균색은 유지한다", async () => {
    const plain = { background: "#4488cc" }
    const baseline = await backdrop(plain)
    const textured = await backdrop({
      ...plain,
      backgroundTexture: { textureAmount: 60 },
    })
    const region = (pixels: Buffer, channel: number) => {
      const values: number[] = []
      for (let i = channel; i < pixels.length; i += 4) values.push(pixels[i])
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const deviation = Math.sqrt(
        values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
      )
      return { mean, deviation }
    }
    expect(region(baseline, 2).deviation).toBe(0)
    expect(region(textured, 2).deviation).toBeGreaterThan(0.5)
    expect(
      Math.abs(region(textured, 2).mean - region(baseline, 2).mean)
    ).toBeLessThan(3)
    expect(Buffer.compare(alpha(textured), alpha(baseline))).toBe(0)

    const coarse = await backdrop({
      ...plain,
      backgroundTexture: { textureAmount: 100, textureScale: 400 },
    })
    const fine = await backdrop({
      ...plain,
      backgroundTexture: { textureAmount: 100, textureScale: 50 },
    })
    expect(roughness(coarse, 400)).toBeLessThan(roughness(fine, 400))
  })

  it("저장 검증을 통과하고 뒷면에만 있어도 뒷면을 인쇄한다", () => {
    const design = newDesign("card")
    const backgroundTexture = {
      textureKind: "paper" as const,
      textureAmount: 50,
      textureScale: 150,
    }
    const parsed = parseDesign({
      ...design,
      backBackground: { background: "#ffffff", backgroundTexture },
    })
    expect(parsed.backBackground?.backgroundTexture).toEqual(backgroundTexture)
    expect(printsBack(parsed)).toBe(true)
    for (const bad of [
      { textureKind: "wood" },
      { textureAmount: 0 },
      { textureScale: 1000 },
      { color: "#000000" },
    ])
      expect(() => parseDesign({ ...design, backgroundTexture: bad })).toThrow(
        "배경 질감"
      )
  })
})

describe("사진 그레인", () => {
  const grainOver = (patch: Partial<Layer>) =>
    sharp(
      Buffer.from(
        renderToStaticMarkup(
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="360"
            height="360"
            viewBox="0 0 30 30"
          >
            <rect width="30" height="30" fill="#808080" />
            <LayerGraphic
              layer={{
                id: "fx",
                name: "필름 그레인",
                type: "effect",
                effectKind: "grain",
                x: 0,
                y: 0,
                width: 30,
                height: 30,
                fill: "#cccccc",
                ...patch,
              }}
            />
          </svg>
        )
      )
    )
      .ensureAlpha()
      .raw()
      .toBuffer()

  it("회색 막을 덮지 않고 알갱이만 얹어 평균 밝기를 지킨다", async () => {
    const { mean, deviation } = statistics(await grainOver({}), 0)
    expect(Math.abs(mean - 128)).toBeLessThan(3)
    expect(deviation).toBeGreaterThan(2)
  })

  it("입자 크기를 키우면 알갱이가 굵어진다", async () => {
    expect(roughness(await grainOver({ grainScale: 300 }), 360)).toBeLessThan(
      roughness(await grainOver({ grainScale: 50 }), 360)
    )
  })

  it("범위를 벗어난 입자 크기는 저장하지 않는다", () => {
    const design = newDesign("card")
    const photo = { ...layer, x: 1, y: 1, photoEffects: { grain: 50 } }
    expect(() =>
      parseDesign({ ...design, front: [{ ...photo, grainScale: 200 }] })
    ).not.toThrow()
    expect(() =>
      parseDesign({ ...design, front: [{ ...photo, grainScale: 20 }] })
    ).toThrow()
  })
})
