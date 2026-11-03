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
function measureWith(value: number) {
  em = value
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: () => ({ width: em * 100 }),
  } as unknown as RenderingContext)
}

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
    measureWith(10)

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
    measureWith(1.184)
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

  describe("fitTextBoxes", () => {
    const narrow = {
      ...layer,
      fontFamily: "'Black Han Sans', sans-serif",
      text: "커트",
      fontSize: 15,
      width: 16.8,
      height: 18,
    }
    const designOf = (...front: Layer[]) =>
      ({
        kind: "pet",
        productId: "",
        widthMm: 210,
        heightMm: 297,
        front,
        back: [],
      }) as unknown as Design

    // 글꼴이 도착하기 전엔 대체 글꼴 폭(2em)으로 재지고, 도착하면 진짜 폭(1.184em)이 된다
    function fontsArriving(arrives: boolean) {
      measureWith(2)
      let arrive = () => {}
      const load = vi.fn(
        () =>
          new Promise((resolve) => {
            arrive = () => {
              if (arrives) em = 1.184
              resolve([])
            }
          })
      )
      const faces = arrives
        ? [{ family: '"Black Han Sans"', status: "loaded" }]
        : [{ family: "Noto Sans KR", status: "loaded" }]
      Object.defineProperty(document, "fonts", {
        value: Object.assign(new EventTarget(), {
          load,
          check: () => true,
          [Symbol.iterator]: () => faces[Symbol.iterator](),
        }),
        configurable: true,
      })

      return { load, arrive: () => arrive() }
    }

    it("글꼴이 도착한 뒤의 폭으로 글상자를 맞춘다", async () => {
      const { load, arrive } = fontsArriving(true)
      const { fitTextBoxes, fittedFontSize } = await import("./graphic")

      const pending = fitTextBoxes(designOf(narrow))
      await vi.waitFor(() => expect(load).toHaveBeenCalled())
      arrive()
      const fitted = (await pending).front[0]

      expect(load).toHaveBeenCalledWith(expect.stringContaining("16px"), "커트")
      expect(fitted.width).toBe(17.8)
      expect(fittedFontSize(fitted)).toBe(15)
    })

    it("앞뒷면 id 가 겹쳐도 맞춘 글상자만 바꾼다", async () => {
      const { load, arrive } = fontsArriving(true)
      const { fitTextBoxes } = await import("./graphic")
      const rect = {
        id: narrow.id,
        type: "rect",
        x: 0,
        y: 0,
        width: 5,
        height: 5,
      } as Layer
      const zero = { ...narrow, fontSize: 0 }

      const pending = fitTextBoxes({ ...designOf(narrow, zero), back: [rect] })
      await vi.waitFor(() => expect(load).toHaveBeenCalled())
      arrive()
      const fitted = await pending

      expect(fitted.front[0].width).toBe(17.8)
      expect(fitted.front[1]).toEqual(zero)
      expect(fitted.back[0]).toEqual(rect)
    })

    it("받지 못한 글꼴과 글자 크기 0 인 글상자는 그대로 둔다", async () => {
      const { load, arrive } = fontsArriving(false)
      const { fitTextBoxes } = await import("./graphic")
      const zero = { ...narrow, id: "z", fontSize: 0 }

      const pending = fitTextBoxes(designOf(narrow, zero))
      await vi.waitFor(() => expect(load).toHaveBeenCalled())
      arrive()
      const [kept, zeroKept] = (await pending).front

      expect(kept).toEqual(narrow)
      expect(zeroKept).toEqual(zero)
    })
  })
})
