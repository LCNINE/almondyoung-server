// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Design, Layer } from "../lib/document"

const layer = {
  id: "t",
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 24,
  text: "아몬드",
  fontSize: 20,
  fontFamily: "Black Han Sans",
} as Layer

// graphic 은 잰 값을 담는 canvas 를 모듈에 한 번 만들어 두므로, 폭은 이 변수 하나로 바꾼다
let em = 10

describe("LayerGraphic", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("글꼴이 늦게 도착하면 대체 글꼴로 줄인 글자 크기를 되돌린다", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const fonts = new EventTarget()
    Object.defineProperty(document, "fonts", {
      value: fonts,
      configurable: true,
    })
    // 대체 글꼴은 폭이 10em 이라 상자에 맞추면 10 으로 줄고, 진짜 글꼴은 3em 이라 20 그대로 들어간다
    em = 10
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: () => ({ width: em * 100 }),
    } as unknown as RenderingContext)

    const { LayerGraphic } = await import("./graphic")
    const host = document.createElement("div")
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <svg>
          <LayerGraphic layer={layer} />
        </svg>
      )
    )
    const size = () => host.querySelector("text")?.getAttribute("font-size")
    expect(size()).toBe("10")

    em = 3
    await act(async () => {
      fonts.dispatchEvent(new Event("loadingdone"))
    })
    expect(size()).toBe("20")
    root.unmount()
  })

  it("글상자 너비를 줄이면 글자 크기는 두고 장평으로 맞춘다", async () => {
    em = 1.184
    const { fittedFontSize, stretchText } = await import("./graphic")
    const heading = {
      ...layer,
      text: "커트",
      fontSize: 15,
      width: 17.8,
      height: 18,
    }

    const narrowed = {
      ...heading,
      ...stretchText(heading, { width: 16.8, height: 18 }),
    }

    expect(narrowed.fontSize).toBe(15)
    expect(narrowed.widthScale).toBe(94.6)
    expect(fittedFontSize(narrowed)).toBeCloseTo(15, 1)
  })

  it("JSON 으로 들여온 글상자를 글꼴을 받은 뒤 글자 폭에 맞춘다", async () => {
    em = 1.184
    const load = vi.fn().mockResolvedValue([])
    Object.defineProperty(document, "fonts", {
      value: Object.assign(new EventTarget(), { load }),
      configurable: true,
    })
    const { fitTextBoxes, fittedFontSize } = await import("./graphic")
    const narrow = {
      ...layer,
      text: "커트",
      fontSize: 15,
      width: 16.8,
      height: 18,
    }
    const design = {
      kind: "pet",
      productId: "",
      widthMm: 210,
      heightMm: 297,
      front: [narrow],
      back: [],
    } as unknown as Design

    const fitted = (await fitTextBoxes(design)).front[0]

    expect(load).toHaveBeenCalledWith(expect.stringContaining("16px"), "커트")
    expect(fitted.width).toBe(17.8)
    expect(fittedFontSize(fitted)).toBe(15)
  })
})
