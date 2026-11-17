import { renderToStaticMarkup } from "react-dom/server"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { parseDesign, newDesign, type Layer } from "../lib/document"
import { shapeOutline } from "../lib/path-shape"
import { Backdrop, LayerGraphic } from "./graphic"

const SIZE = 200

async function pixels(children: React.ReactNode) {
  const html = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
    >
      <rect width={SIZE} height={SIZE} fill="#000000" />
      {children}
    </svg>
  )
  const raw = await sharp(Buffer.from(html)).ensureAlpha().raw().toBuffer()
  return (x: number, y: number) => {
    const at = (y * SIZE + x) * 4
    return [raw[at], raw[at + 1], raw[at + 2]] as const
  }
}

const square: Layer = {
  id: "box",
  name: "네모",
  type: "rect",
  x: 60,
  y: 60,
  width: 80,
  height: 80,
  fill: "#0000ff",
}

describe("글로우", () => {
  it("모양 바깥으로 고른 색 빛이 번지고, 멀어질수록 약해진다", async () => {
    const off = await pixels(<LayerGraphic layer={square} />)
    const on = await pixels(
      <LayerGraphic
        layer={{
          ...square,
          glow: true,
          glowColor: "#ffff00",
          glowSize: 6,
          glowOpacity: 0.8,
        }}
      />
    )

    expect(off(52, 100)).toEqual([0, 0, 0])
    const near = on(56, 100)
    const far = on(36, 100)
    expect(near[0]).toBeGreaterThan(150)
    expect(near[1]).toBeGreaterThan(150)
    expect(near[2]).toBeLessThan(60)
    expect(far[0]).toBeLessThan(near[0])
    // 모양 자체 색은 빛에 덮이지 않는다
    expect(on(100, 100)).toEqual([0, 0, 255])
  })

  it("글자에도 걸린다", async () => {
    const text: Layer = {
      id: "t",
      name: "글",
      type: "text",
      text: "■",
      x: 40,
      y: 40,
      width: 120,
      height: 120,
      fontSize: 100,
      fill: "#ffffff",
      glow: true,
      glowColor: "#ff0000",
      glowSize: 5,
    }
    const on = await pixels(<LayerGraphic layer={text} />)
    let red = 0
    for (let x = 0; x < SIZE; x += 2)
      for (let y = 0; y < SIZE; y += 2) {
        const [r, g, b] = on(x, y)
        if (r > 80 && g < 40 && b < 40) red++
      }
    expect(red).toBeGreaterThan(50)
  })
})

describe("글로우 종류", () => {
  it("네온은 속을 빛 색의 흰빛으로 칠하고 테두리 안쪽부터 빛 색이 스민다", async () => {
    const at = await pixels(
      <LayerGraphic
        layer={{
          ...square,
          glow: true,
          glowStyle: "neon",
          glowColor: "#ff0000",
          glowSize: 4,
        }}
      />
    )
    const [r, g, b] = at(100, 100)
    expect(r).toBe(255)
    expect(g).toBeGreaterThan(180)
    expect(b).toBeGreaterThan(180)
    const rim = at(61, 100)
    expect(rim[0]).toBeGreaterThan(200)
    expect(rim[1]).toBeLessThan(g)
  })

  it("퍼짐을 올리면 같은 거리에서 빛이 더 진하다", async () => {
    const glow = async (glowSpread?: number) =>
      (
        await pixels(
          <LayerGraphic
            layer={{
              ...square,
              glow: true,
              glowColor: "#ffffff",
              glowSize: 4,
              glowOpacity: 0.5,
              glowSpread,
            }}
          />
        )
      )(50, 100)[0]
    expect(await glow(100)).toBeGreaterThan(await glow())
  })

  it("종류·퍼짐 값이 틀리면 저장하지 않는다", () => {
    const design = newDesign("card")
    const layer = { ...square, x: 1, y: 1, width: 20, height: 20, glow: true }
    for (const bad of [{ glowStyle: "fire" }, { glowSpread: 120 }])
      expect(() =>
        parseDesign({ ...design, front: [{ ...layer, ...bad }] })
      ).toThrow()
    expect(() =>
      parseDesign({
        ...design,
        front: [{ ...layer, glowStyle: "neon", glowSpread: 30 }],
      })
    ).not.toThrow()
  })
})

describe("사각형 모서리 둥글기", () => {
  it("값이 클수록 모서리가 깎이고 100 이면 짧은 변이 반원이다", async () => {
    const at = async (cornerRadius?: number, shapeVariant?: string) =>
      (
        await pixels(
          <LayerGraphic layer={{ ...square, cornerRadius, shapeVariant }} />
        )
      )(63, 63)

    expect(await at()).toEqual([0, 0, 255])
    expect(await at(0, "rounded")).toEqual([0, 0, 255])
    expect(await at(50)).not.toEqual([0, 0, 255])
    expect(await at(undefined, "rounded")).not.toEqual([0, 0, 255])

    const pill = await pixels(
      <LayerGraphic layer={{ ...square, cornerRadius: 100 }} />
    )
    expect(pill(100, 61)).toEqual([0, 0, 255])
    expect(pill(70, 70)).not.toEqual([0, 0, 255])
  })

  it("점 편집 윤곽도 같은 둥글기를 따른다", () => {
    expect(shapeOutline({ ...square, cornerRadius: 0 })).toHaveLength(4)
    expect(
      shapeOutline({ ...square, shapeVariant: "rounded", cornerRadius: 0 })
    ).toHaveLength(4)
    expect(shapeOutline({ ...square, cornerRadius: 50 })).toHaveLength(8)
  })

  it("범위를 벗어난 값은 저장하지 않는다", () => {
    const design = newDesign("card")
    const layer = { ...square, x: 1, y: 1, width: 20, height: 20 }
    expect(() =>
      parseDesign({ ...design, front: [{ ...layer, cornerRadius: 50 }] })
    ).not.toThrow()
    expect(() =>
      parseDesign({ ...design, front: [{ ...layer, cornerRadius: 101 }] })
    ).toThrow()
  })
})

describe("배경 그라데이션", () => {
  it("배경색 위, 배경 사진 아래에 그린다", async () => {
    const at = await pixels(
      <Backdrop
        width={SIZE}
        height={SIZE}
        value={{
          background: "#ffffff",
          backgroundGradient: {
            type: "linear",
            from: "#ff0000",
            to: "#0000ff",
            fromOpacity: 1,
            toOpacity: 1,
            angle: 0,
          },
        }}
      />
    )
    const [lr, , lb] = at(5, 100)
    const [rr, , rb] = at(195, 100)
    expect(lr).toBeGreaterThan(200)
    expect(lb).toBeLessThan(50)
    expect(rb).toBeGreaterThan(200)
    expect(rr).toBeLessThan(50)
  })

  it("투명도를 낮추면 배경색이 비친다", async () => {
    const at = await pixels(
      <Backdrop
        width={SIZE}
        height={SIZE}
        value={{
          background: "#00ff00",
          backgroundGradient: {
            type: "linear",
            from: "#ff0000",
            to: "#ff0000",
            fromOpacity: 0,
            toOpacity: 0,
            angle: 0,
          },
        }}
      />
    )
    expect(at(100, 100)).toEqual([0, 255, 0])
  })

  it("저장 검증을 통과하고 뒷면에만 있어도 뒷면을 인쇄한다", () => {
    const gradient = {
      type: "radial" as const,
      from: "#ff0000",
      to: "#0000ff",
      fromOpacity: 1,
      toOpacity: 0.5,
      angle: 0,
    }
    const design = newDesign("card")
    expect(
      parseDesign({
        ...design,
        backgroundGradient: gradient,
        backBackground: { background: "#ffffff", backgroundGradient: gradient },
      }).backBackground?.backgroundGradient
    ).toEqual(gradient)
    expect(() =>
      parseDesign({
        ...design,
        backgroundGradient: { ...gradient, from: "red" },
      })
    ).toThrow("배경 그라데이션")
  })
})

describe("사진 그림자", () => {
  it("업로드한 사진 아래로 그림자가 진다", async () => {
    const png = await sharp({
      create: { width: 10, height: 10, channels: 4, background: "#ffffff" },
    })
      .png()
      .toBuffer()
    const photo: Layer = {
      id: "p",
      name: "사진",
      type: "image",
      image: `data:image/png;base64,${png.toString("base64")}`,
      x: 40,
      y: 40,
      width: 80,
      height: 80,
      fill: "#000000",
    }
    const html = (layer: Layer) =>
      pixels(
        <>
          <rect width={SIZE} height={SIZE} fill="#ffffff" />
          <LayerGraphic layer={layer} />
        </>
      )
    const plain = await html(photo)
    const shadowed = await html({
      ...photo,
      shadow: true,
      shadowX: 10,
      shadowY: 10,
      shadowBlur: 1,
      shadowColor: "#000000",
      shadowOpacity: 1,
    })
    expect(plain(125, 125)).toEqual([255, 255, 255])
    expect(shadowed(125, 125)[0]).toBeLessThan(60)
    expect(shadowed(80, 80)).toEqual([255, 255, 255])
  })
})
