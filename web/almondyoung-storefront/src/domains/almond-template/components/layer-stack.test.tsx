import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { newDesign, parseDesign, type Layer } from "../lib/document"
import { LayerStack } from "./layer-stack"

const rect: Layer = {
  id: "box",
  type: "rect",
  name: "사각형",
  x: 10,
  y: 10,
  width: 60,
  height: 30,
  fill: "#222222",
}
const text: Layer = {
  id: "word",
  type: "text",
  name: "글자",
  x: 15,
  y: 15,
  width: 50,
  height: 20,
  fill: "#ffffff",
  text: "ALMOND",
  fontSize: 12,
}
const top: Layer = { ...rect, id: "top", y: 50 }

const render = (layers: Layer[]) =>
  renderToStaticMarkup(
    <svg>
      <LayerStack layers={layers} />
    </svg>
  )

describe("레이어 꾸미기", () => {
  it("뚫어내기 글자는 아래 레이어에만 구멍을 내고 자기는 투명하게 남는다", () => {
    const html = render([rect, { ...text, knockout: true }, top])

    expect(html).toContain('mask="url(#ko-box)"')
    expect(html).not.toContain("ko-top")
    expect(html).not.toContain("ko-word")
    expect(html).toMatch(/<mask id="ko-box"[^]*fill="#000000"[^]*ALMOND/)
    expect(html).toMatch(/fill-opacity="0"[^>]*>.*ALMOND/)
  })

  it("숨긴 뚫어내기 글자는 구멍을 내지 않는다", () => {
    expect(
      render([rect, { ...text, knockout: true, visible: false }])
    ).not.toContain("mask=")
  })

  it("그라데이션·필터·혼합 모드가 SVG 에 실린다", () => {
    const html = render([
      {
        ...rect,
        blendMode: "multiply",
        colorFilter: { kind: "overlay", amount: 60, color: "#ff0000" },
        gradient: {
          type: "linear",
          from: "#ff0000",
          to: "#0000ff",
          fromOpacity: 1,
          toOpacity: 0,
          angle: 90,
        },
      },
    ])

    expect(html).toContain("mix-blend-mode:multiply")
    expect(html).toContain('fill="url(#grad-box)"')
    expect(html).toContain('stop-opacity="0"')
    expect(html).toContain('filter="url(#cf-box)"')
    expect(html).toContain('mode="overlay"')
  })

  it("강도 0 필터는 필터를 걸지 않는다", () => {
    const html = render([
      { ...rect, colorFilter: { kind: "grayscale", amount: 0 } },
    ])

    expect(html).not.toContain("cf-box")
  })

  it("시안 검사가 새 값을 받고 잘못된 값은 거절한다", () => {
    const design = (layer: Layer) => ({
      ...newDesign("card"),
      front: [layer],
    })

    expect(() =>
      parseDesign(
        design({
          ...text,
          knockout: true,
          blendMode: "color-dodge",
          colorFilter: { kind: "retro", amount: 50 },
        })
      )
    ).not.toThrow()
    expect(() => parseDesign(design({ ...rect, knockout: true }))).toThrow()
    expect(() =>
      parseDesign(design({ ...rect, blendMode: "bogus" as never }))
    ).toThrow()
    expect(() =>
      parseDesign(
        design({ ...rect, colorFilter: { kind: "blur", amount: 101 } })
      )
    ).toThrow()
    expect(() =>
      parseDesign(
        design({
          ...rect,
          gradient: { ...rect, type: "linear" } as never,
        })
      )
    ).toThrow()
  })
})
