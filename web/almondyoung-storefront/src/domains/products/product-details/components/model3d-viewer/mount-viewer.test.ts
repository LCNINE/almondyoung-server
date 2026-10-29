// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { mountViewer } from "./mount-viewer"

vi.mock("@google/model-viewer", () => {
  class ModelViewerElement extends HTMLElement {
    static meshoptDecoderLocation = ""
    static modelCacheSize = 0
    src: string | null = null
  }

  customElements.define("model-viewer", ModelViewerElement)

  return { ModelViewerElement }
})

afterEach(() => vi.restoreAllMocks())

describe("mountViewer", () => {
  it("rejects unsupported WebGL instead of leaving a successfully downloaded model blank", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    const container = document.createElement("div")

    await expect(
      mountViewer(container, {
        src: "model.glb",
        alt: "상품",
        onLoad: vi.fn(),
        onError: vi.fn(),
      })
    ).rejects.toThrow("WebGL")
    expect(container.children).toHaveLength(0)
  })

  it("enables controls and removes the model and event handlers on disposal", async () => {
    const loseContext = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      getExtension: () => ({ loseContext }),
    } as unknown as WebGL2RenderingContext)
    const container = document.createElement("div")
    const onLoad = vi.fn()
    const onError = vi.fn()
    const dispose = await mountViewer(container, {
      src: "model.glb",
      alt: "상품",
      onLoad,
      onError,
    })
    const viewer = container.querySelector("model-viewer")!

    expect(viewer.hasAttribute("camera-controls")).toBe(true)
    expect(viewer.getAttribute("alt")).toBe("상품")
    expect(loseContext).toHaveBeenCalledTimes(1)
    viewer.dispatchEvent(new Event("load"))
    expect(onLoad).toHaveBeenCalledTimes(1)

    dispose()
    viewer.dispatchEvent(new Event("error"))

    expect(container.children).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
  })
})
