// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Layer } from "../lib/document"

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
    let em = 10
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
})
