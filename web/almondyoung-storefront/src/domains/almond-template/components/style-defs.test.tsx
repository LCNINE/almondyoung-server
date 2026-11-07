import { renderToStaticMarkup } from "react-dom/server"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { COLOR_FILTERS, type ColorFilter } from "../lib/layer-style"
import { unfiltered, type Layer } from "../lib/document"
import { Backdrop, LayerGraphic } from "./graphic"
import { LayerStack } from "./layer-stack"
import { ColorFilterDef } from "./style-defs"
import { ColorFilterFields } from "./editor/layer-style-controls"

const render = (filter?: ColorFilter, blur?: number) =>
  renderToStaticMarkup(
    <svg>
      <ColorFilterDef id="test" filter={filter} blur={blur} size={40} />
    </svg>
  )

describe("톤 망점 SVG", () => {
  it("PNG 타일을 종횡비 여백 없이 mm 좌표로 반복하고 크기만 변경한다", () => {
    const html = render({ kind: "tone", amount: 60 })
    const large = render({ kind: "tone", amount: 60, dotSize: 100 })

    expect(html).toContain('primitiveUnits="userSpaceOnUse"')
    expect(html).toMatch(
      /<feImage href="data:image\/png;base64,[^"]+" preserveAspectRatio="none"/
    )
    expect(html).toContain('width="1" height="1" result="toneTile"')
    expect(html).toContain('<feTile in="toneTile" result="toneGrid"')
    expect(large).toContain('width="2.2" height="2.2" result="toneTile"')
    expect(html).toContain('in2="SourceAlpha" operator="in" result="styled"')
    expect(html).toContain('k2="0.6" k3="0.4"')
    expect(render({ kind: "retro", amount: 60 })).not.toContain("feImage")
    expect(render({ kind: "tone", amount: 0 })).not.toContain("feTile")
  })

  it("배경도 50mm 기준으로 같은 망점 타일을 사용한다", () => {
    const html = renderToStaticMarkup(
      <svg>
        <Backdrop
          value={{
            background: "#ffffff",
            backgroundImage: "data:image/png;base64,AA==",
            backgroundFilter: { kind: "tone", amount: 100 },
          }}
        />
      </svg>
    )

    expect(html).toContain('width="1.25" height="1.25" result="toneTile"')
    expect(html).toContain("feTile")
  })

  it("공용 필터 UI에서 톤일 때만 기본값 40인 망점 크기를 보여준다", () => {
    const fields = (value: ColorFilter) =>
      renderToStaticMarkup(
        <ColorFilterFields value={value} disabled={false} onChange={() => {}} />
      )
    const html = fields({ kind: "tone", amount: 70 })

    expect(html).toMatch(/aria-label="망점 크기" min="1" max="100"/)
    expect(html).toMatch(/aria-label="망점 크기 값"[^>]*value="40"/)
    expect(fields({ kind: "tone", amount: 70, dotSize: 80 })).toMatch(
      /aria-label="망점 크기 값"[^>]*value="80"/
    )
    expect(fields({ kind: "grayscale", amount: 70 })).not.toContain("망점 크기")
  })

  it("직렬화한 SVG에서 어두울수록 검정 점이 커지고 알파는 보존된다", async () => {
    const coverage: number[] = []

    for (const fill of ["#333333", "#808080", "#cccccc"]) {
      const html = renderToStaticMarkup(
        <svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
          <ColorFilterDef
            id="tone"
            filter={{ kind: "tone", amount: 100 }}
            size={400}
          />
          <rect
            x="80"
            y="80"
            width="100"
            height="100"
            fill={fill}
            fillOpacity={0.5}
            filter="url(#tone)"
          />
        </svg>
      )
      const pixels = await sharp(Buffer.from(html))
        .ensureAlpha()
        .raw()
        .toBuffer()
      let black = 0
      let invalidPixels = 0

      for (let y = 80; y < 180; y++) {
        for (let x = 80; x < 180; x++) {
          const offset = (y * 240 + x) * 4

          if (
            pixels[offset + 3] !== 128 ||
            pixels[offset] !== pixels[offset + 1] ||
            pixels[offset] !== pixels[offset + 2]
          ) {
            invalidPixels++
          }

          if (pixels[offset] < 128) {
            black++
          }
        }
      }

      expect(pixels[(79 * 240 + 100) * 4 + 3]).toBe(0)
      expect(invalidPixels).toBe(0)
      expect(black).toBeGreaterThan(0)
      expect(black).toBeLessThan(10000)
      coverage.push(black)
    }

    expect(coverage[0]).toBeGreaterThan(coverage[1])
    expect(coverage[1]).toBeGreaterThan(coverage[2])
  })
})

describe("독립 블러 SVG", () => {
  it.each(["background", "image", "window"] as const)(
    "%s 블러는 사진 네 모서리를 바래게 하지 않는다",
    async (route) => {
      const png = await sharp({
        create: { width: 100, height: 100, channels: 4, background: "#000000" },
      })
        .png()
        .toBuffer()
      const image = `data:image/png;base64,${png.toString("base64")}`
      const background = { background: "#ffffff", backgroundImage: image }
      const layer: Layer = {
        id: "photo",
        name: "사진",
        type: "image",
        image,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: "#000000",
        blur: 100,
      }

      for (const colorFilter of [
        undefined,
        { kind: "grayscale" as const, amount: 100 },
        { kind: "tone" as const, amount: 100 },
      ]) {
        const html = renderToStaticMarkup(
          <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
            {route === "background" ? (
              <Backdrop
                value={{
                  ...background,
                  backgroundBlur: 100,
                  backgroundFilter: colorFilter,
                }}
              />
            ) : route === "image" ? (
              <LayerGraphic layer={{ ...layer, colorFilter }} />
            ) : (
              <LayerStack
                layers={[{ ...layer, type: "rect", colorFilter }]}
                backdrop={() => <Backdrop value={background} />}
              />
            )}
          </svg>
        )
        const pixels = await sharp(Buffer.from(html))
          .ensureAlpha()
          .raw()
          .toBuffer()

        for (const [x, y] of [
          [0, 0],
          [99, 0],
          [0, 99],
          [99, 99],
        ]) {
          const offset = (y * 100 + x) * 4

          expect(Array.from(pixels.subarray(offset, offset + 4))).toEqual([
            0, 0, 0, 255,
          ])
        }
      }
    }
  )

  it("사진 블러는 원본의 투명 영역과 반투명 알파를 보존한다", async () => {
    const png = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="50" width="50" height="100" fill="black" fill-opacity="0.5"/></svg>'
      )
    )
      .png()
      .toBuffer()
    const html = renderToStaticMarkup(
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <LayerGraphic
          layer={{
            id: "transparent",
            name: "투명 사진",
            type: "image",
            image: `data:image/png;base64,${png.toString("base64")}`,
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            fill: "none",
            blur: 100,
          }}
        />
      </svg>
    )
    const pixels = await sharp(Buffer.from(html)).ensureAlpha().raw().toBuffer()

    expect(pixels[(50 * 100 + 49) * 4 + 3]).toBe(0)
    expect(pixels[(50 * 100 + 50) * 4 + 3]).toBe(128)
  })

  it("글자 자체 블러는 글상자 밖으로 계속 번진다", async () => {
    const html = renderToStaticMarkup(
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <LayerGraphic
          layer={{
            id: "text-blur",
            name: "글자",
            type: "text",
            text: "H",
            fontSize: 50,
            x: 25,
            y: 25,
            width: 50,
            height: 50,
            fill: "#000000",
            blur: 100,
          }}
        />
      </svg>
    )
    const pixels = await sharp(Buffer.from(html)).ensureAlpha().raw().toBuffer()
    const outside = Array.from(
      { length: 100 },
      (_, y) => pixels[(y * 100 + 24) * 4 + 3]
    )

    expect(outside.some((alpha) => alpha > 0)).toBe(true)
    expect(html).not.toContain('edgeMode="duplicate"')
  })

  it("선택 가능한 색 필터에서 블러를 제외한다", () => {
    expect(COLOR_FILTERS.map(([kind]) => kind)).not.toContain("blur")
  })

  it("블러 다음에 흑백을 한 필터 안에서 적용한다", () => {
    const html = render({ kind: "grayscale", amount: 75 }, 50)

    expect(html.match(/<filter /g)).toHaveLength(1)
    expect(html).toContain('<feGaussianBlur stdDeviation="3" result="blurred"')
    expect(html).toContain(
      '<feColorMatrix in="blurred" type="saturate" values="0.25"'
    )
    expect(html.indexOf("feGaussianBlur")).toBeLessThan(
      html.indexOf("feColorMatrix")
    )
  })

  it("필터만, 블러만, 효과 없음과 강도 0을 구분한다", () => {
    const colorOnly = render({ kind: "grayscale", amount: 60 })
    const blurOnly = render(undefined, 50)
    const zeroColor = render({ kind: "grayscale", amount: 0 }, 50)

    expect(colorOnly).toContain('in="SourceGraphic"')
    expect(colorOnly).not.toContain("feGaussianBlur")
    expect(blurOnly).toContain("feGaussianBlur")
    expect(blurOnly).not.toContain("feColorMatrix")
    expect(zeroColor).toBe(blurOnly)
    expect(render(undefined, 0)).not.toContain("<filter")
    expect(render({ kind: "retro", amount: 0 }, 0)).not.toContain("<filter")
  })

  it.each([
    "tone",
    "retro",
    "overlay",
    "color-dodge",
    "color-burn",
    "multiply",
  ] as const)("%s의 혼합과 알파 마스크도 블러 결과를 사용한다", (kind) => {
    const html = render({ kind, amount: 60 }, 50)

    expect(html).toContain(
      '<feComposite in2="blurred" operator="in" result="styled"'
    )
    expect(html).toContain(
      '<feComposite in="styled" in2="blurred" operator="arithmetic"'
    )
    expect(html).not.toContain("SourceGraphic")
    expect(html).not.toContain("SourceAlpha")
  })

  it.each([undefined, { kind: "grayscale" as const, amount: 100 }])(
    "배경 사진에 블러를 적용하고 필터 무효화 시 제거한다: %s",
    (backgroundFilter) => {
      const value = {
        background: "#ffffff",
        backgroundImage: "data:image/png;base64,AA==",
        backgroundFilter,
        backgroundBlur: 40,
      }
      const html = renderToStaticMarkup(
        <svg>
          <Backdrop value={value} />
        </svg>
      )
      const raw = renderToStaticMarkup(
        <svg>
          <Backdrop value={unfiltered(value)} />
        </svg>
      )

      expect(html).toContain('<feGaussianBlur stdDeviation="3"')
      expect(html).toMatch(/<image[^>]*filter="url\(#bg-cf-/)
      expect(raw).not.toContain("<filter")
      expect(raw).not.toContain('filter="url(')
    }
  )
})
